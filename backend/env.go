package main

import (
	"bufio"
	"errors"
	"io/fs"
	"os"
	"strings"
)

// loadDotEnv reads KEY=VALUE lines from path into the process environment and returns
// the names it set, in file order.
//
// This exists because the alternative was worse than the dependency it saved. The server
// reads configuration through os.Getenv only, so before this a `.env` file sitting beside
// the binary was completely inert — and the symptom was a 503 from an endpoint, with
// nothing anywhere connecting that to the file the operator had just filled in. Copying
// `.env.example` to `.env` is the first thing anyone tries; it silently doing nothing is a
// trap, not a design.
//
// No dependency was added for it: dotenv's format is KEY=VALUE, and the parser below is
// the whole of it. ADR-001's stdlib-first rule is satisfied by writing thirty lines rather
// than by refusing the feature, and go.mod stays at two direct dependencies.
//
// Precedence: **a real environment variable always wins.** A value already present in the
// environment is never overwritten, so `.env` is a convenience for local development and
// can never silently shadow what a deployment actually set. That ordering is the reason
// this is safe to call unconditionally at startup.
//
// A missing file is not an error — the deployed case has no `.env` at all.
func loadDotEnv(path string) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	defer f.Close()

	var set []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		key, value, ok := parseDotEnvLine(scanner.Text())
		if !ok {
			continue
		}
		// The precedence rule, and the only line that enforces it.
		if _, present := os.LookupEnv(key); present {
			continue
		}
		if err := os.Setenv(key, value); err != nil {
			return set, err
		}
		set = append(set, key)
	}
	return set, scanner.Err()
}

// parseDotEnvLine splits one line into a key and value, reporting false for anything
// that isn't an assignment — blank lines, comments, and malformed lines are skipped
// rather than being errors, because a typo three lines down should not stop the server
// from reading the four variables above it.
//
// Handled: surrounding whitespace, a leading `export `, and a value wrapped in matching
// single or double quotes (which is how a value with spaces or a trailing `#` is written).
//
// ponytail: no escape-sequence or ${VAR} interpolation. Nothing in .env.example needs
// either, and interpolation in particular is its own footgun — add it only if a real
// value turns out to need it.
func parseDotEnvLine(line string) (key, value string, ok bool) {
	line = strings.TrimSpace(line)
	if line == "" || strings.HasPrefix(line, "#") {
		return "", "", false
	}
	line = strings.TrimPrefix(line, "export ")

	key, value, found := strings.Cut(line, "=")
	if !found {
		return "", "", false
	}
	key = strings.TrimSpace(key)
	if key == "" {
		return "", "", false
	}

	value = strings.TrimSpace(value)
	if len(value) >= 2 {
		if q := value[0]; (q == '"' || q == '\'') && value[len(value)-1] == q {
			value = value[1 : len(value)-1]
		}
	}
	return key, value, true
}
