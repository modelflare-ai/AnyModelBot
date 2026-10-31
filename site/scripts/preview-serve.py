#!/usr/bin/env python3
"""
预览用的静态服务（裸 IP:端口，不经过 Caddy）：压缩和缓存照线上 nginx（deploy/nginx.conf）来，预览的加载速度才有参考价值。
`python3 -m http.server` 只会 HTTP/1.0、不压缩：首页 HTML 346 KB 原样传，每个请求都重新建连接，远程打开很慢。

- HTTP/1.1 长连接、多线程
- 文本类（html / css / js / json / svg / xml / webmanifest / txt / md）按需 gzip，压缩结果按（路径, 修改时间, 大小）缓存在内存里
- 缓存头：/_astro/（带哈希的构建产物）和 /fonts/ → 一年 immutable，同线上；其他 → no-cache（每次用 Last-Modified
  重新验证，重新部署后刷新就能看到，没改的文件只回 304）
- 目录有 index.html 就直接给，不先 301 到带斜杠的地址（同 nginx 的 try_files）
- 其余同 http.server：没有 index 的目录补斜杠后列目录、If-Modified-Since → 304

用法：python3 -I preview-serve.py [--port 18600] [--bind 0.0.0.0] [--directory /srv/amb-preview]
只依赖标准库。
"""
import argparse
import datetime
import email.utils
import gzip
import http.server
import io
import os
import threading
import urllib.parse
from http import HTTPStatus

COMPRESSIBLE = ("text/", "application/javascript", "application/json", "application/manifest+json", "application/xml", "image/svg+xml")
MIN_GZIP = 256  # 太小的文件压了反而更大

_gz_cache: dict[str, tuple[int, int, bytes]] = {}
_gz_lock = threading.Lock()


def gzipped(path: str, st: os.stat_result) -> bytes:
    key = (st.st_mtime_ns, st.st_size)
    with _gz_lock:
        hit = _gz_cache.get(path)
    if hit and hit[:2] == key:
        return hit[2]
    with open(path, "rb") as f:
        data = gzip.compress(f.read(), compresslevel=6, mtime=0)
    with _gz_lock:
        _gz_cache[path] = (*key, data)
    return data


def accepts_gzip(header: str | None) -> bool:
    for part in (header or "").split(","):
        name, _, params = part.strip().partition(";")
        if name.strip().lower() in ("gzip", "*"):
            q = params.strip().lower()
            try:
                return not (q.startswith("q=") and float(q[2:] or 0) == 0)
            except ValueError:
                return False
    return False


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    timeout = 30  # 空闲的长连接 30 秒后关掉，不一直占着线程
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".webmanifest": "application/manifest+json",
        ".webp": "image/webp",
        ".avif": "image/avif",
        ".woff2": "font/woff2",
        ".md": "text/plain; charset=utf-8",
    }

    def send_head(self):
        url = urllib.parse.urlsplit(self.path)
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            index = next((os.path.join(path, n) for n in ("index.html", "index.htm") if os.path.isfile(os.path.join(path, n))), None)
            # 有 index.html 就直接给（同 nginx 的 try_files $uri/index.html）：站内链接都不带斜杠，不必多跳一次 301
            if index is None:
                if not url.path.endswith("/"):
                    self.send_response(HTTPStatus.MOVED_PERMANENTLY)
                    self.send_header("Location", urllib.parse.urlunsplit((url.scheme, url.netloc, url.path + "/", url.query, url.fragment)))
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return None
                return super().send_head()  # 目录列表
            path = index
        if path.endswith("/") or not os.path.isfile(path):
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return None
        try:
            st = os.stat(path)
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return None
        ctype = self.guess_type(path)
        compressible = ctype.startswith(COMPRESSIBLE)
        cache = "public, max-age=31536000, immutable" if ("/_astro/" in url.path or "/fonts/" in url.path) else "no-cache"

        def common_headers():
            self.send_header("Last-Modified", self.date_time_string(st.st_mtime))
            self.send_header("Cache-Control", cache)
            if compressible:
                self.send_header("Vary", "Accept-Encoding")

        ims = self.headers.get("If-Modified-Since")
        if ims and "If-None-Match" not in self.headers:
            try:
                since = email.utils.parsedate_to_datetime(ims)
            except (TypeError, IndexError, OverflowError, ValueError):
                since = None
            if since is not None:
                if since.tzinfo is None:
                    since = since.replace(tzinfo=datetime.timezone.utc)
                if datetime.datetime.fromtimestamp(st.st_mtime, datetime.timezone.utc).replace(microsecond=0) <= since:
                    self.send_response(HTTPStatus.NOT_MODIFIED)
                    common_headers()
                    self.end_headers()
                    return None

        if compressible and st.st_size >= MIN_GZIP and accepts_gzip(self.headers.get("Accept-Encoding")):
            body = gzipped(path, st)
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(body)))
            common_headers()
            self.end_headers()
            return io.BytesIO(body)
        f = open(path, "rb")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(st.st_size))
        common_headers()
        self.end_headers()
        return f


def main() -> None:
    ap = argparse.ArgumentParser(description="预览用静态服务（gzip + 长连接 + 缓存头）")
    ap.add_argument("--port", type=int, default=18600)
    ap.add_argument("--bind", default="0.0.0.0")
    ap.add_argument("--directory", default=os.getcwd())
    a = ap.parse_args()
    root = os.path.abspath(a.directory)

    class Bound(Handler):
        def __init__(self, *args, **kw):
            super().__init__(*args, directory=root, **kw)

    srv = http.server.ThreadingHTTPServer((a.bind, a.port), Bound)
    srv.daemon_threads = True
    print(f"serving {root} on http://{a.bind}:{a.port}/", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
