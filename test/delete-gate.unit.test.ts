/** 完全权限下的递归删除闸门：哪些命令要问、哪些直接执行；插件钩子只在完全权限下生效。 */
import path from "node:path";
import { describe, expect, it } from "vitest";

const plugin = path.join(__dirname, "..", "dsh-runtime", "plugins", "amb-delete-gate.mjs");
const load = async (): Promise<any> => import(plugin + `?t=${Math.random()}`);
const ps64 = (s: string) => Buffer.from(s, "utf16le").toString("base64");

// bash 工具（Linux / macOS）：必须问
const BASH_ASK = [
  "rm -r build",
  "rm -R build",
  "rm -rf build",
  "rm -fr build",
  "rm -Rf build",
  "rm -rfv build",
  "rm -f -r build",
  "rm --recursive build",
  "rm --recursive --force build",
  "rm --rec build", // getopt 认长选项前缀
  "rm build -rf", // GNU rm 允许选项写在后面
  "rm -r -- build",
  "/bin/rm -rf build",
  "/usr/bin/rm -rf build",
  "\\rm -rf build",
  "'rm' -rf build",
  '"rm" -rf build',
  "r''m -rf build",
  "sudo rm -rf /var/tmp/x",
  "sudo -u root rm -rf x",
  "doas rm -rf x",
  "env FOO=1 rm -rf x",
  "FOO=1 rm -rf x",
  "nice -n 10 rm -rf x",
  "timeout 10 rm -rf x",
  "command rm -rf x",
  "exec rm -rf x",
  "busybox rm -rf x",
  "cd /tmp && rm -rf x",
  "ls; rm -rf x",
  "true || rm -rf x",
  "make && rm -rf dist &",
  "rm -rf x > /dev/null 2>&1",
  "(cd a && rm -rf b)",
  "{ rm -rf x; }",
  "if [ -d x ]; then rm -rf x; fi",
  "for d in a b; do rm -r \"$d\"; done",
  "echo $(rm -rf x)",
  "echo `rm -rf x`",
  "$(which rm) -rf x",
  "bash -c 'rm -rf x'",
  'sh -c "rm -rf x"',
  "bash -lc 'cd /tmp; rm -rf x'",
  "zsh -c 'rm -r x'",
  "eval \"rm -rf x\"",
  "ssh host 'rm -rf /srv/x'",
  "ssh host rm -rf /srv/x",
  "docker exec c rm -rf /data",
  "docker exec c sh -c 'rm -rf /data'",
  "watch rm -rf x",
  "rm \\\n  -rf x",
  "find . -name node_modules -type d -prune -exec rm -rf '{}' +",
  "find . -type f -name '*.log' -delete",
  "find /tmp/x -delete",
  "find . -name '*.o' -exec rm {} \\;",
  "find . -name '*.o' -execdir rm -f {} +",
  "find . -name '*.o' | xargs rm",
  "find . -name '*.o' -print0 | xargs -0 rm -f",
  "ls | xargs -I{} rm -r {}",
  "cat list.txt | xargs -n1 rm -rf",
  "ls | parallel rm -r",
  "git clean -fdx",
  "git clean -fd",
  "git clean -xfd",
  "git clean --force -d",
  "git clean -f",
  "git -C repo clean -fdx",
  "git -c core.x=y clean -ffdx",
  "git rm -r old",
  "git rm -rf old",
  "git submodule foreach 'rm -rf build'",
  "git rebase --exec 'rm -rf x' main",
  "tar --remove-files -czf a.tgz dir",
  "zip -rm a.zip dir",
  "rsync -a --delete src/ dst/",
  "rsync -av --delete-after src/ dst/",
  "rsync -a --del src/ dst/",
  "npx rimraf dist",
  "rimraf dist",
  "pnpm dlx rimraf dist",
  "python3 -c 'import shutil; shutil.rmtree(\"x\")'",
  "python3 -c \"from shutil import rmtree; rmtree('x')\"",
  "python3 -c \"import subprocess; subprocess.run(['rm', '-rf', 'x'])\"",
  "python3 -c \"import os; os.system('rm -rf x')\"",
  "node -e \"require('fs').rmSync('x', { recursive: true, force: true })\"",
  "node -e \"fs.promises.rm('x', {recursive:true})\"",
  "node -e \"require('fs').rmdirSync('x', {recursive: true})\"",
  "node -e \"require('child_process').execSync('rm -rf x')\"",
  "perl -MFile::Path=remove_tree -e 'remove_tree(\"x\")'",
  "perl -MFile::Path -e 'rmtree(\"x\")'",
  "ruby -rfileutils -e 'FileUtils.rm_rf(\"x\")'",
  "ruby -e 'FileUtils.rm_r(\"x\")'",
  "go run main.go # os.RemoveAll",
  "rm -rf $DIR",
  "rm $FLAGS build", // 变量可能展开成 -r
  "rm -f ${OUT}",
  "rm $(cat dirs.txt)",
  "srm -r secret",
  "pwsh -Command 'Remove-Item x -Recurse'",
  "cmd.exe /c 'rd /s /q C:\\x'",
  "cat > clean.sh <<'EOF'\nrm -rf build\nEOF\nbash clean.sh",
  // 宁可多问：引号里的文字也当命令查
  "echo 'rm -rf is dangerous'",
  "git commit -m 'stop using rm -r here'",
];

// bash 工具：直接执行（不问）
const BASH_OK = [
  "rm file.txt",
  "rm -f file.txt",
  "rm -i file.txt",
  "rm -v a.log b.log",
  "rm -d emptydir",
  "rm -f \"$tmp\"",
  "rm -- -file",
  "rmdir emptydir",
  "rmdir -p a/b/c",
  "unlink file.txt",
  "ls -R",
  "ls -la",
  "cp -r a b",
  "mv a b",
  "grep -rn rm .",
  "grep -r 'TODO' src",
  "find . -name '*.py'",
  "find . -type d -name rm",
  "git rm file.txt",
  "git rm -r --cached build",
  "git -C repo rm -r --cached build",
  "git clean -n",
  "git clean -nd",
  "git clean --dry-run -fd",
  "git status",
  "git log --grep clean",
  "ls -R | grep rm",
  "npm uninstall rimraf",
  "tar -czf a.tgz dir",
  "zip -r a.zip dir",
  "chmod -R 755 . && rm a.txt",
  "docker rm -f c1",
  "npm install rimraf",
  "npm i -D rimraf",
  "npm run build",
  "rsync -a src/ dst/",
  "python3 -c 'print(1)'",
  "echo hello > out.txt",
  "mkdir -p a/b && touch a/b/c",
  "cat README.md | head -5",
  "ls -R | head",
  "",
  "   ",
];

// pwsh 工具（Windows）：必须问
const PS_ASK = [
  "Remove-Item C:\\x -Recurse",
  "Remove-Item -Path C:\\x -Recurse -Force",
  "Remove-Item C:\\x -Recurse:$true",
  "Remove-Item C:\\x -recurse",
  "Remove-Item C:\\x -RECURSE",
  "Remove-Item C:\\x -r",
  "Remove-Item C:\\x -R",
  "Remove-Item C:\\x -Rec",
  "Remove-Item C:\\x -recurs",
  "Remove-Item C:\\x \u2013Recurse", // en dash
  "Remove-Item C:\\x \u2014Recurse", // em dash
  "remove-item -LiteralPath 'C:\\x y' -Force -Recurse",
  "Microsoft.PowerShell.Management\\Remove-Item C:\\x -Recurse",
  "& 'Remove-Item' C:\\x -Recurse",
  "rm C:\\x -r -fo",
  "rm -r C:\\x",
  "rm -rf C:\\x",
  "rm -Recurse -Force C:\\x",
  "del C:\\x -Recurse",
  "erase C:\\x -Recurse",
  "ri C:\\x -r",
  "rd C:\\x -Recurse",
  "rmdir C:\\x -Recurse -Force",
  "Re`move-Item C:\\x -Re`curse",
  "$p = @{ Recurse = $true }; Remove-Item C:\\x @p",
  "Get-ChildItem C:\\x -Recurse | Remove-Item -Force",
  "gci -r *.tmp | rm",
  "Get-ChildItem C:\\x -Recurse -File | ForEach-Object { Remove-Item $_.FullName }",
  "gci C:\\x -r | % { $_.Delete() }",
  "Get-ChildItem C:\\x | Remove-Item -Recurse -Force",
  "cmd /c rd /s /q C:\\x",
  "cmd /c \"rd /s /q C:\\x\"",
  "cmd.exe /C \"rmdir /S /Q C:\\x\"",
  "cmd /c rd/s/q C:\\x",
  "cmd /c del /s /q C:\\x\\*.tmp",
  "cmd /c del /f/s/q C:\\x",
  "cmd /c erase /s C:\\x\\*",
  "cmd /c r^d /s /q C:\\x",
  "Start-Process cmd -ArgumentList '/c rd /s /q C:\\x' -Wait",
  "Invoke-Expression 'Remove-Item C:\\x -Recurse'",
  "iex \"Remove-Item C:\\x -Recurse\"",
  "[System.IO.Directory]::Delete('C:\\x', $true)",
  "[IO.Directory]::Delete('C:\\x', $true)",
  "(Get-Item C:\\x).Delete($true)",
  "robocopy C:\\empty C:\\x /MIR",
  "robocopy C:\\a C:\\b /PURGE",
  "git clean -fdx",
  "npx rimraf dist",
  `pwsh -NoProfile -EncodedCommand ${ps64("Remove-Item C:\\x -Recurse")}`,
  `powershell -enc ${ps64("Remove-Item C:\\x -Recurse")}`,
  `powershell.exe -e ${ps64("rm -r C:\\x")}`,
  "powershell -Command \"Remove-Item C:\\x -Recurse\"",
  "if (Test-Path C:\\x) { Remove-Item C:\\x -Recurse -Force }",
  "if ($?) { rd C:\\x -r }",
  "Remove-Item -Path \"$env:USERPROFILE\\proj\\node_modules\" -Recurse -Force -ErrorAction SilentlyContinue",
  "Get-ChildItem -Path C:\\x -Include *.tmp -Recurse | Remove-Item",
  "cmd /c dir C:\\x /s /b | del",
  "Remove-Item C:\\x -Recurse -WhatIf", // 宁可多问
];

// pwsh 工具：直接执行（不问）
const PS_OK = [
  "Remove-Item C:\\x\\file.txt",
  "Remove-Item C:\\x\\file.txt -Force",
  "rm C:\\x\\file.txt -Force",
  "rm C:\\x\\file.txt -fo",
  "del C:\\x\\file.txt",
  "Remove-Item $path -ErrorAction SilentlyContinue",
  "Remove-Item -LiteralPath $p -Confirm:$false",
  "Get-ChildItem C:\\x -Recurse | Select-String foo",
  "Get-ChildItem -Recurse -Filter *.cs | Measure-Object",
  "Get-ChildItem -Recurse | Where-Object { $_.Name -like 'rm' }",
  "gci C:\\x *.log | Remove-Item",
  "Copy-Item C:\\a C:\\b -Recurse",
  "New-Item -ItemType Directory C:\\x -Force",
  "cmd /c dir /s /b",
  "cmd /c del C:\\x\\a.txt",
  "rmdir C:\\x\\empty",
  "robocopy C:\\a C:\\b /E",
  "Remove-ItemProperty -Path HKCU:\\x -Name y",
  "git rm -r --cached build",
  `pwsh -EncodedCommand ${ps64("Get-ChildItem C:\\x")}`,
  "Write-Output 'hello'",
];

describe("recursiveDelete matcher", () => {
  it.each(BASH_ASK)("bash asks: %s", async (cmd) => {
    expect((await load()).recursiveDelete(cmd, { shell: "posix" })).toBeTruthy();
  });
  it.each(BASH_OK)("bash runs: %s", async (cmd) => {
    expect((await load()).recursiveDelete(cmd, { shell: "posix" })).toBeUndefined();
  });
  it.each(PS_ASK)("pwsh asks: %s", async (cmd) => {
    expect((await load()).recursiveDelete(cmd, { shell: "ps" })).toBeTruthy();
  });
  it.each(PS_OK)("pwsh runs: %s", async (cmd) => {
    expect((await load()).recursiveDelete(cmd, { shell: "ps" })).toBeUndefined();
  });

  it("checks scripts named on the command line", async () => {
    const { recursiveDelete } = await load();
    const files: Record<string, string> = { "clean.sh": "#!/bin/sh\nrm -rf build\n", "ok.sh": "echo hi\n", "tools/x.ps1": "Remove-Item C:\\x -Recurse\n", "y.py": "import shutil\nshutil.rmtree('x')\n" };
    const read = (p: string) => files[p.replace(/^\.[\\/]/, "")];
    expect(recursiveDelete("bash clean.sh", { read })).toBe("clean.sh: rm -rf");
    expect(recursiveDelete("./clean.sh --all", { read })).toBe("./clean.sh: rm -rf");
    expect(recursiveDelete("sh ok.sh && echo done", { read })).toBeUndefined();
    expect(recursiveDelete("& tools/x.ps1", { shell: "ps", read })).toBeTruthy();
    expect(recursiveDelete("python3 y.py", { read })).toBe("y.py: rmtree");
    expect(recursiveDelete("bash -x clean.sh", { read })).toBe("clean.sh: rm -rf");
    expect(recursiveDelete("chmod +x clean.sh && ./clean.sh", { read })).toBe("./clean.sh: rm -rf");
    expect(recursiveDelete("pwsh -NoProfile -File tools/x.ps1", { shell: "ps", read })).toBeTruthy();
    // 只是读脚本（cat、grep）不问；读不到的脚本也不问
    expect(recursiveDelete("cat clean.sh", { read })).toBeUndefined();
    expect(recursiveDelete("grep -n build clean.sh", { read })).toBeUndefined();
    expect(recursiveDelete("bash missing.sh", { read })).toBeUndefined();
  });

  it("says what matched", async () => {
    const { recursiveDelete } = await load();
    expect(recursiveDelete("sudo rm -rf /x")).toBe("rm -rf");
    expect(recursiveDelete("Remove-Item C:\\x -Recurse", { shell: "ps" })).toBe("Remove-Item -Recurse");
    expect(recursiveDelete("cmd /c rd /s /q C:\\x", { shell: "ps" })).toBe("rd /s");
    expect(recursiveDelete("git clean -fdx")).toBe("git clean");
    expect(recursiveDelete("find . -delete")).toBe("find -delete");
  });
});

describe("delete gate plugin", () => {
  const run = async (mode: string | undefined, exec: any, downstream: any = { kind: "allow" }) => {
    const prev = process.env.DSH_PERMISSION_MODE;
    if (mode) process.env.DSH_PERMISSION_MODE = mode;
    else delete process.env.DSH_PERMISSION_MODE;
    let hook: any;
    (await load()).apply({ on: (_ev: string, fn: any) => (hook = fn) });
    if (prev === undefined) delete process.env.DSH_PERMISSION_MODE;
    else process.env.DSH_PERMISSION_MODE = prev;
    return hook ? hook(exec, async () => downstream) : { kind: "allow", noHook: true };
  };
  const bash = (command: string) => ({ name: "bash", arguments: { description: "x", command } });

  it("only loads for full access", async () => {
    expect(await run("workspace-write", bash("rm -rf x"))).toMatchObject({ noHook: true });
    expect(await run("read-only", bash("rm -rf x"))).toMatchObject({ noHook: true });
    expect(await run(undefined, bash("rm -rf x"))).toMatchObject({ noHook: true });
  });

  it("turns recursive deletes into an approval request and lets everything else through", async () => {
    const ask = await run("danger-full-access", bash("rm -rf build"));
    expect(ask).toMatchObject({ kind: "ask", displayReason: { zh: "递归删除，需要你确认（rm -rf）" } });
    expect(await run("danger-full-access", bash("rm build/a.txt"))).toEqual({ kind: "allow" });
    expect(await run("danger-full-access", bash("echo hi > /etc/x"))).toEqual({ kind: "allow" });
    // pwsh 按 PowerShell 的规则：rm -Force 不是递归
    expect(await run("danger-full-access", { name: "pwsh", arguments: { command: "rm C:\\x\\a.txt -Force" } })).toEqual({ kind: "allow" });
    expect((await run("danger-full-access", { name: "pwsh", arguments: { command: "rm C:\\x -r" } })).kind).toBe("ask");
    // 参数是 JSON 字符串也认
    expect((await run("danger-full-access", { name: "bash", arguments: JSON.stringify({ command: "rm -r x" }) })).kind).toBe("ask");
    // 没有 command 的工具不管
    expect(await run("danger-full-access", { name: "read", arguments: { file_path: "rm -rf" } })).toEqual({ kind: "allow" });
  });

  it("keeps a downstream deny or ask as is", async () => {
    expect(await run("danger-full-access", bash("rm -rf x"), { kind: "deny", reason: "no" })).toEqual({ kind: "deny", reason: "no" });
    const other = { kind: "ask", reason: "computer use" };
    expect(await run("danger-full-access", bash("rm -rf x"), other)).toBe(other);
  });
});
