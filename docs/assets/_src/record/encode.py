#!/usr/bin/env python3
"""把 record.mjs 录下的帧编码成 README 素材，并用程序核对（不看图）。依赖：Python 3 + Pillow ≥ 10。

  python3 encode.py <job.json>        按任务文件编码一个 GIF 或 WebP，打印一行 JSON 结果
  python3 encode.py --verify <文件…>  核对成品：尺寸、帧数、时长、体积，以及有没有全空白 / 全黑的帧段

GIF 任务：
  {"kind": "gif", "frames": [[时间戳秒, png 路径], …], "t0": 起点, "duration": 秒, "fps": 帧率, "size": [宽, 高],
   "crop": [x, y, w, h] 或 null, "out": 输出路径, "limit": 体积上限字节, "hold": 最后一帧停留秒数（默认 1）}
  按目标帧率重采样：第 k 帧取时间戳 ≤ t0 + k/fps 的最后一张屏幕帧；最后一帧停 hold 秒，无限循环。
  全局调色板（从均匀抽样的若干帧里取 255 色，第 256 色留作透明），不抖动；第 2 帧起只存变化区域，区域里没变的像素记成透明，\n  相同的相邻帧合并；写完解码一遍逐帧比对。
  超出体积上限时按 docs/assets/README.md 的顺序处理：有损（相邻帧色差很小的像素沿用上一帧，减少到 192 色）→
  帧率降到 8 → 宽度降到 800；三步之后仍超就报错，不放宽上限、也不自动缩短时长。
WebP 任务：
  {"kind": "webp", "src": png 路径, "size": [1600, 1093], "quality": 82, "out": 输出路径, "limit": 体积上限字节}
"""
import bisect
import json
import os
import sys

from PIL import Image, ImageChops, ImageSequence, ImageStat


def sample_times(duration, fps, hold):
    n = round((duration - hold) * fps)
    times = [k / fps for k in range(n)] + [duration - hold]
    # GIF 的延时单位是 10 毫秒：按累计时间取整，12 fps 时 80 / 90 毫秒交替，平均 83.3
    cum = [k * 1000 / fps for k in range(n + 1)]
    durs = [int(round(cum[k + 1] / 10) * 10 - round(cum[k] / 10) * 10) for k in range(n)]
    durs.append(int(round(hold * 1000)))
    return times, durs


def load_frames(job, fps, width):
    stamps = [f[0] for f in job["frames"]]
    times, durs = sample_times(job["duration"], fps, job.get("hold", 1.0))
    w0, h0 = job["size"]
    size = (width, round(h0 * width / w0)) if width != w0 else (w0, h0)
    cache = {}
    out = []
    for t in times:
        i = bisect.bisect_right(stamps, job["t0"] + t) - 1
        if i < 0:
            i = 0
        path = job["frames"][i][1]
        if path not in cache:
            im = Image.open(path).convert("RGB")
            if job.get("crop"):
                x, y, w, h = job["crop"]
                im = im.crop((x, y, x + w, y + h))
            cache[path] = im.resize(size, Image.LANCZOS)
        out.append(cache[path])
    return out, durs


def palette_for(frames, colors):
    picks = frames[:: max(1, len(frames) // 24)][:24]
    w, h = picks[0].size
    sw, sh = w // 2, h // 2
    cols = 6
    rows = (len(picks) + cols - 1) // cols
    mosaic = Image.new("RGB", (sw * cols, sh * rows))
    for i, f in enumerate(picks):
        mosaic.paste(f.resize((sw, sh), Image.BOX), ((i % cols) * sw, (i // cols) * sh))
    pal = mosaic.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, kmeans=1)
    # 没用到的调色板项（含留给透明的 255）都填成第 0 色：映射时就算选中它们，颜色也和第 0 色一样，之后统一改回 0
    used = len(pal.getcolors(256))
    rgb = pal.getpalette()[: used * 3]
    pal.putpalette(rgb + rgb[:3] * (256 - used))
    pal.info["used"] = used
    return pal


def quantize(f, pal):
    p = f.quantize(palette=pal, dither=Image.Dither.NONE)
    used = pal.info["used"]
    idx = as_index(p).point(lambda v: v if v < used else 0)
    q = Image.frombytes("P", p.size, idx.tobytes())
    q.putpalette(pal.getpalette())
    return q


def stabilize(prev_rgb, cur_rgb, prev_p, cur_p, thr):
    """有损：和上一帧颜色差不到 thr 的像素直接沿用上一帧（GIF 里就成了没变化的区域）"""
    diff = ImageChops.difference(prev_rgb, cur_rgb).convert("L")
    keep = diff.point(lambda v: 255 if v < thr else 0)
    out = cur_p.copy()
    out.paste(prev_p, (0, 0), keep)
    return out


TRANSPARENT = 255  # 调色板只用 0–254，255 留给"和上一帧一样"的像素


def as_index(p):
    """把 P 图的调色板索引原样当成 L 图（用来比较两帧的索引是否相同）"""
    return Image.frombytes("L", p.size, p.tobytes())


def gif_bytes(pframes, durs, palette):
    """自己写 GIF 容器：全局调色板 + 无限循环；第 2 帧起只写变化区域的外接矩形，矩形里没变的像素记成透明（disposal 1，叠在上一帧上）。
    每帧的 LZW 数据用 Pillow 的 GifImagePlugin.getdata() 编码。完全相同的相邻帧合并成一帧（延时相加）。"""
    from PIL import GifImagePlugin

    w, h = pframes[0].size
    frames = []  # [图, 偏移, 延时, 是否用透明]
    prev = None
    for p, d in zip(pframes, durs):
        if prev is None:
            frames.append([p, (0, 0), d, False])
        else:
            diff = ImageChops.difference(as_index(prev), as_index(p))
            box = diff.getbbox()
            if not box:
                frames[-1][2] += d
                continue
            crop = p.crop(box)
            same = diff.crop(box).point(lambda v: 255 if v == 0 else 0)
            crop.paste(TRANSPARENT, (0, 0), same)
            frames.append([crop, box[:2], d, True])
        prev = p
    pal = (palette + [0] * 768)[:768]
    out = [b"GIF89a", w.to_bytes(2, "little"), h.to_bytes(2, "little"), bytes([0xF7, 0, 0]), bytes(pal)]
    out.append(b"!\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00")
    for im, off, d, tr in frames:
        params = {"duration": d, "disposal": 1}
        if tr:
            params["transparency"] = TRANSPARENT
        out.extend(GifImagePlugin.getdata(im, offset=off, **params))
    out.append(b";")
    return b"".join(out), len(frames)


def write_gif(job, fps, width, lossy):
    frames, durs = load_frames(job, fps, width)
    pal = palette_for(frames, 192 if lossy else 255)
    pframes = []
    prev_rgb = prev_p = None
    for f in frames:
        p = quantize(f, pal)
        if lossy and prev_p is not None:
            p = stabilize(prev_rgb, f, prev_p, p, 10)
        pframes.append(p)
        prev_rgb, prev_p = f, p
    data, _ = gif_bytes(pframes, durs, pal.getpalette()[:768])
    out = job["out"]
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "wb") as fh:
        fh.write(data)
    roundtrip(out, pframes, pal)
    return os.path.getsize(out)


def roundtrip(path, pframes, pal):
    """解码刚写出的 GIF，逐帧和编码前的画面比对，确认透明叠加没有出错"""
    im = Image.open(path)
    want = [f.convert("RGB") for f in pframes]
    # 相同的相邻帧被合并了：解码出的第 i 帧对应去重后的序列
    uniq = [want[0]]
    for a, b in zip(pframes, pframes[1:]):
        if ImageChops.difference(as_index(a), as_index(b)).getbbox():
            uniq.append(b.convert("RGB"))
    n = 0
    for i, fr in enumerate(ImageSequence.Iterator(im)):
        got = fr.convert("RGB")
        if ImageChops.difference(got, uniq[i]).getbbox():
            raise SystemExit(f"{path}: 第 {i} 帧解码后和编码前不一致")
        n += 1
    if n != len(uniq):
        raise SystemExit(f"{path}: 帧数不对（{n} ≠ {len(uniq)}）")


def encode_gif(job):
    limit = job["limit"]
    w0 = job["size"][0]
    steps = [("原样", job["fps"], w0, False), ("有损", job["fps"], w0, True), ("帧率 8", min(8, job["fps"]), w0, True), ("宽度 800", min(8, job["fps"]), min(800, w0), True)]
    tried = []
    for name, fps, width, lossy in steps:
        size = write_gif(job, fps, width, lossy)
        tried.append(f"{name}: {size / 1048576:.2f} MB")
        if size <= limit:
            return {"out": job["out"], "steps": tried, "fps": fps, "width": width, "lossy": lossy, **inspect(job["out"])}
    raise SystemExit(f"{job['out']} 三步压缩后仍超过上限 {limit / 1048576:.2f} MB：{'；'.join(tried)}（按要求不放宽上限，请缩短时长）")


def encode_webp(job):
    im = Image.open(job["src"]).convert("RGB").resize(tuple(job["size"]), Image.LANCZOS)
    os.makedirs(os.path.dirname(job["out"]), exist_ok=True)
    im.save(job["out"], "WEBP", quality=job.get("quality", 82), method=6)
    r = {"out": job["out"], **inspect(job["out"])}
    if r["bytes"] > job["limit"]:
        raise SystemExit(f"{job['out']} 超过上限：{r['bytes']} > {job['limit']}")
    return r


def frame_stats(im):
    g = im.convert("L").resize((240, max(1, round(240 * im.size[1] / im.size[0]))), Image.BOX)
    s = ImageStat.Stat(g)
    return s.mean[0], s.stddev[0]


def inspect(path):
    """尺寸、帧数、总时长、体积，以及全空白 / 全黑的帧段（标准差 < 2 视为一片纯色）"""
    im = Image.open(path)
    n = getattr(im, "n_frames", 1)
    total = 0
    flat = []
    run = 0
    worst = []
    for i, fr in enumerate(ImageSequence.Iterator(im)):
        total += fr.info.get("duration", 0) or 0
        mean, std = frame_stats(fr.convert("RGB"))
        worst.append(std)
        if std < 2:
            run += 1
            flat.append((i, round(mean)))
        else:
            run = 0
    return {
        "bytes": os.path.getsize(path),
        "width": im.size[0],
        "height": im.size[1],
        "frames": n,
        "duration_ms": total if n > 1 else 0,
        "flat_frames": flat,
        "min_std": round(min(worst), 1),
        "black": any(m < 4 for _, m in flat),
        "blank": any(m > 251 for _, m in flat),
    }


def main(argv):
    if not argv:
        sys.exit(__doc__)
    if argv[0] == "--verify":
        for p in argv[1:]:
            print(json.dumps({"out": p, **inspect(p)}, ensure_ascii=False))
        return
    with open(argv[0], encoding="utf-8") as fh:
        job = json.load(fh)
    r = encode_gif(job) if job["kind"] == "gif" else encode_webp(job)
    print(json.dumps(r, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1:])
