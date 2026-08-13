package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseDotEnvLine(t *testing.T) {
	cases := []struct {
		line, key, value string
		ok               bool
	}{
		{`ORS_API_KEY=abc123`, "ORS_API_KEY", "abc123", true},
		{`  ORS_API_KEY = abc123  `, "ORS_API_KEY", "abc123", true},
		{`export ORS_API_KEY=abc123`, "ORS_API_KEY", "abc123", true},
		{`NAME="two words"`, "NAME", "two words", true},
		{`NAME='two words'`, "NAME", "two words", true},
		{`EMPTY=`, "EMPTY", "", true},
		// A JWT secret is base64 and routinely ends in '='. Splitting on the FIRST '='
		// is what keeps it intact; splitting on the last, or on every one, would corrupt
		// exactly the value whose corruption is hardest to debug.
		{`SUPABASE_JWT_SECRET=aGVsbG8=`, "SUPABASE_JWT_SECRET", "aGVsbG8=", true},
		{`URL=https://x.supabase.co/auth/v1?a=1`, "URL", "https://x.supabase.co/auth/v1?a=1", true},
		// Skipped, not errors.
		{``, "", "", false},
		{`   `, "", "", false},
		{`# a comment`, "", "", false},
		{`   # indented comment`, "", "", false},
		{`no equals sign here`, "", "", false},
		{`=novalue`, "", "", false},
	}
	for _, c := range cases {
		key, value, ok := parseDotEnvLine(c.line)
		if ok != c.ok || key != c.key || value != c.value {
			t.Errorf("parseDotEnvLine(%q) = (%q, %q, %v), want (%q, %q, %v)",
				c.line, key, value, ok, c.key, c.value, c.ok)
		}
	}
}

// The precedence rule from loadDotEnv's doc comment, asserted directly: a real
// environment variable must survive a .env that disagrees with it. This is what makes it
// safe to call loadDotEnv unconditionally at startup — a deployment's real config can
// never be shadowed by a stray file in the working directory.
func TestLoadDotEnvDoesNotOverrideRealEnv(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	if err := os.WriteFile(path, []byte("HORIZON_TEST_A=from-file\nHORIZON_TEST_B=from-file\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HORIZON_TEST_A", "from-env")

	names, err := loadDotEnv(path)
	if err != nil {
		t.Fatalf("loadDotEnv: %v", err)
	}
	if got := os.Getenv("HORIZON_TEST_A"); got != "from-env" {
		t.Errorf("HORIZON_TEST_A = %q, want the real environment to win", got)
	}
	if got := os.Getenv("HORIZON_TEST_B"); got != "from-file" {
		t.Errorf("HORIZON_TEST_B = %q, want the file value for an unset variable", got)
	}
	// Only the variable it actually set is reported, so the startup log doesn't claim
	// credit for values that came from the environment.
	if len(names) != 1 || names[0] != "HORIZON_TEST_B" {
		t.Errorf("names = %v, want only [HORIZON_TEST_B]", names)
	}
	os.Unsetenv("HORIZON_TEST_B")
}

// A missing .env is the normal deployed case and must not be an error.
func TestLoadDotEnvMissingFileIsNotAnError(t *testing.T) {
	names, err := loadDotEnv(filepath.Join(t.TempDir(), "does-not-exist"))
	if err != nil {
		t.Errorf("err = %v, want nil for a missing file", err)
	}
	if len(names) != 0 {
		t.Errorf("names = %v, want empty", names)
	}
}

// A malformed line must not stop the variables around it from loading — a typo on line
// three should cost you line three, not the whole file.
func TestLoadDotEnvSkipsJunkWithoutDroppingGoodLines(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	content := "# comment\nHORIZON_TEST_C=one\nthis line is junk\n\nHORIZON_TEST_D=two\n"
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	defer func() {
		os.Unsetenv("HORIZON_TEST_C")
		os.Unsetenv("HORIZON_TEST_D")
	}()

	names, err := loadDotEnv(path)
	if err != nil {
		t.Fatalf("loadDotEnv: %v", err)
	}
	if len(names) != 2 {
		t.Fatalf("names = %v, want both good lines", names)
	}
	if os.Getenv("HORIZON_TEST_C") != "one" || os.Getenv("HORIZON_TEST_D") != "two" {
		t.Error("a junk line prevented a later valid line from loading")
	}
}
