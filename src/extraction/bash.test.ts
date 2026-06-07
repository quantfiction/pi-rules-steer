import { describe, expect, it } from "vitest";
import { extractBashScope } from "./bash.js";

const CWD = "/proj";

describe("extractBashScope — unrecognized verbs", () => {
  it("returns null for non-search verbs", () => {
    for (const cmd of [
      "echo hello",
      "pnpm test",
      "node script.js",
      "git status",
      "make build",
      "true",
      "",
      "   ",
    ]) {
      expect(extractBashScope(cmd, CWD)).toBeNull();
    }
  });

  it("returns null for find (deferred to pi-bash-steer)", () => {
    expect(extractBashScope("find . -name '*.ts'", CWD)).toBeNull();
    expect(extractBashScope("find docs/ -name '*.md'", CWD)).toBeNull();
  });

  it("returns null for sed / awk / wc / stat (deferred to v0.3)", () => {
    expect(extractBashScope("sed -i 's/x/y/' file", CWD)).toBeNull();
    expect(extractBashScope("awk '{print}' file", CWD)).toBeNull();
    expect(extractBashScope("wc -l file", CWD)).toBeNull();
    expect(extractBashScope("stat file", CWD)).toBeNull();
  });
});

describe("extractBashScope — leading prefix handling", () => {
  it("strips `cd <path> &&` and parses the trailing verb against the cd'd cwd", () => {
    expect(extractBashScope("cd /proj && grep foo src/index.ts", CWD)).toEqual({
      scope: "src/index.ts",
      glob: null,
    });
  });

  it("strips env-var prefix", () => {
    expect(extractBashScope("FOO=bar grep pattern src/index.ts", CWD)).toEqual({
      scope: "src/index.ts",
      glob: null,
    });
  });

  it("strips wrapper verbs (timeout / nice / nohup / stdbuf / time)", () => {
    expect(extractBashScope("timeout 30 grep pattern src/index.ts", CWD)).toEqual({
      scope: "src/index.ts",
      glob: null,
    });
    expect(extractBashScope("nice -n 10 grep pattern src/index.ts", CWD)).toEqual({
      scope: "src/index.ts",
      glob: null,
    });
  });

  it("returns null when only a wrapper / env prefix is present", () => {
    expect(extractBashScope("timeout 30", CWD)).toBeNull();
    expect(extractBashScope("FOO=bar", CWD)).toBeNull();
  });
});

describe("extractBashScope — grep (non-recursive)", () => {
  it("extracts the FILE positional (second non-flag)", () => {
    expect(extractBashScope("grep pattern src/index.ts", CWD)).toEqual({
      scope: "src/index.ts",
      glob: null,
    });
  });

  it("returns null when only PATTERN is supplied (pipeline input)", () => {
    expect(extractBashScope("grep pattern", CWD)).toBeNull();
  });

  it("skips boolean flags", () => {
    expect(extractBashScope("grep -n -i pattern src/index.ts", CWD)).toEqual({
      scope: "src/index.ts",
      glob: null,
    });
  });

  it("skips flag-with-separate-value pairs (-A/-B/-C/-e/-f/-m)", () => {
    expect(extractBashScope("grep -A 3 -B 3 pattern src/index.ts", CWD)).toEqual({
      scope: "src/index.ts",
      glob: null,
    });
    expect(extractBashScope("grep -e pat1 -e pat2 src/index.ts", CWD)).toEqual({
      scope: "src/index.ts",
      glob: null,
    });
  });

  it("skips long-form flags with `=`", () => {
    expect(extractBashScope("grep --color=auto pattern src/index.ts", CWD)).toEqual({
      scope: "src/index.ts",
      glob: null,
    });
  });

  it("returns null for recursive shapes (deferred to pi-bash-steer)", () => {
    expect(extractBashScope("grep -r pattern src/", CWD)).toBeNull();
    expect(extractBashScope("grep -R pattern src/", CWD)).toBeNull();
    expect(extractBashScope("grep --recursive pattern src/", CWD)).toBeNull();
    expect(extractBashScope("grep -rn pattern src/", CWD)).toBeNull();
    expect(extractBashScope("grep -nr pattern src/", CWD)).toBeNull();
  });
});

describe("extractBashScope — rg", () => {
  it("extracts the PATH positional (second non-flag)", () => {
    expect(extractBashScope("rg pattern src/", CWD)).toEqual({
      scope: "src",
      glob: null,
    });
  });

  it("returns null when only PATTERN supplied", () => {
    expect(extractBashScope("rg pattern", CWD)).toBeNull();
  });

  it("skips -g GLOB / -t TYPE / -e PAT flag pairs", () => {
    expect(extractBashScope("rg -g '*.ts' -t ts pattern src/", CWD)).toEqual({
      scope: "src",
      glob: null,
    });
  });
});

describe("extractBashScope — ls (non-recursive)", () => {
  it("extracts PATH positional", () => {
    expect(extractBashScope("ls src/", CWD)).toEqual({
      scope: "src",
      glob: null,
    });
  });

  it("skips boolean flags", () => {
    expect(extractBashScope("ls -la src/", CWD)).toEqual({
      scope: "src",
      glob: null,
    });
  });

  it("returns null when no path (cwd-scoped ls)", () => {
    expect(extractBashScope("ls", CWD)).toBeNull();
    expect(extractBashScope("ls -la", CWD)).toBeNull();
  });

  it("returns null for recursive shapes", () => {
    expect(extractBashScope("ls -R src/", CWD)).toBeNull();
    expect(extractBashScope("ls --recursive src/", CWD)).toBeNull();
  });
});

describe("extractBashScope — cat", () => {
  it("extracts FILE positional", () => {
    expect(extractBashScope("cat src/index.ts", CWD)).toEqual({
      scope: "src/index.ts",
      glob: null,
    });
  });

  it("returns null for heredoc-write shape (cat > file <<EOF)", () => {
    expect(
      extractBashScope("cat > src/index.ts <<EOF\nbody\nEOF", CWD),
    ).toBeNull();
  });

  it("returns null for plain redirect-write (cat > file)", () => {
    expect(extractBashScope("cat > src/index.ts", CWD)).toBeNull();
    expect(extractBashScope("cat >> src/index.ts", CWD)).toBeNull();
  });

  it("returns null when cat has no FILE (stdin)", () => {
    expect(extractBashScope("cat", CWD)).toBeNull();
  });

  it("skips boolean flags (-n, -A, -E, -T)", () => {
    expect(extractBashScope("cat -n src/index.ts", CWD)).toEqual({
      scope: "src/index.ts",
      glob: null,
    });
  });
});

describe("extractBashScope — head / tail", () => {
  it("head extracts FILE positional", () => {
    expect(extractBashScope("head -n 30 src/index.ts", CWD)).toEqual({
      scope: "src/index.ts",
      glob: null,
    });
  });

  it("head with short -nNN form (no separator)", () => {
    expect(extractBashScope("head -30 src/index.ts", CWD)).toEqual({
      scope: "src/index.ts",
      glob: null,
    });
  });

  it("tail extracts FILE positional", () => {
    expect(extractBashScope("tail -n 50 docs/CHANGELOG.md", CWD)).toEqual({
      scope: "docs/CHANGELOG.md",
      glob: null,
    });
  });

  it("returns null when no FILE", () => {
    expect(extractBashScope("head -n 30", CWD)).toBeNull();
    expect(extractBashScope("tail -f", CWD)).toBeNull();
  });
});

describe("extractBashScope — fd", () => {
  it("extracts PATH positional (second non-flag)", () => {
    expect(extractBashScope("fd 'pattern' src/", CWD)).toEqual({
      scope: "src",
      glob: null,
    });
  });

  it("returns null when only PATTERN", () => {
    expect(extractBashScope("fd 'pattern'", CWD)).toBeNull();
  });
});

describe("extractBashScope — pipeline / boundary handling", () => {
  it("only parses the FIRST verb of the first pipeline element", () => {
    // `head` after the pipe should not become the verb.
    expect(extractBashScope("grep pattern src/index.ts | head", CWD)).toEqual({
      scope: "src/index.ts",
      glob: null,
    });
  });

  it("stops at && (the next command is not parsed)", () => {
    expect(extractBashScope("grep pattern src/index.ts && echo done", CWD)).toEqual({
      scope: "src/index.ts",
      glob: null,
    });
  });

  it("ignores stderr redirects (2>&1, 2>/dev/null) on read-shaped verbs", () => {
    expect(extractBashScope("grep pattern src/index.ts 2>/dev/null", CWD)).toEqual({
      scope: "src/index.ts",
      glob: null,
    });
    expect(extractBashScope("head -30 src/index.ts 2>&1", CWD)).toEqual({
      scope: "src/index.ts",
      glob: null,
    });
  });

  it("returns null for bash -c / sh -c wrappers (opaque inner string)", () => {
    expect(extractBashScope("bash -c 'grep pattern src/index.ts'", CWD)).toBeNull();
    expect(extractBashScope("sh -c 'cat src/index.ts'", CWD)).toBeNull();
  });
});

describe("extractBashScope — path normalization", () => {
  it("returns null for absolute path outside cwd", () => {
    expect(extractBashScope("cat /etc/passwd", CWD)).toBeNull();
    expect(extractBashScope("head -30 /tmp/some.log", CWD)).toBeNull();
  });

  it("normalizes absolute path inside cwd to project-relative", () => {
    expect(extractBashScope("cat /proj/src/index.ts", CWD)).toEqual({
      scope: "src/index.ts",
      glob: null,
    });
  });

  it("returns null when scope resolves to cwd itself", () => {
    expect(extractBashScope("ls .", CWD)).toBeNull();
    expect(extractBashScope("ls /proj", CWD)).toBeNull();
  });

  it("collapses dotted / trailing-slash segments", () => {
    expect(extractBashScope("ls ./src/", CWD)).toEqual({
      scope: "src",
      glob: null,
    });
    expect(extractBashScope("cat src/./foo.ts", CWD)).toEqual({
      scope: "src/foo.ts",
      glob: null,
    });
  });
});

describe("extractBashScope — quoted-path handling (shell-quote)", () => {
  it("handles single-quoted paths", () => {
    expect(extractBashScope("cat 'src/file with spaces.ts'", CWD)).toEqual({
      scope: "src/file with spaces.ts",
      glob: null,
    });
  });

  it("handles double-quoted paths", () => {
    expect(extractBashScope('cat "src/file with spaces.ts"', CWD)).toEqual({
      scope: "src/file with spaces.ts",
      glob: null,
    });
  });
});

describe("extractBashScope — defensive / pathological input", () => {
  it("returns null for non-string input shape (defensive)", () => {
    // Caller is expected to gate this; included as a no-throw guarantee.
    expect(extractBashScope("", CWD)).toBeNull();
    expect(extractBashScope("\n\t  ", CWD)).toBeNull();
  });

  it("returns null on unparseable command (does not throw)", () => {
    // shell-quote can produce parse-control objects (e.g., for unmatched quotes).
    expect(() => extractBashScope("cat 'unclosed", CWD)).not.toThrow();
  });
});
