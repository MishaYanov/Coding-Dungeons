// Each trusted fixture is a function body with t *testing.T in scope. The
// harness adds testing and the listed standard-library imports. Fixtures
// check observable behavior and leave implementation guidance in the book.
const example = (id, code, imports) => ({ id, code, visibility: 'public', group: 'Examples', imports });
const sealed = (id, group, code, imports) => ({ id, code, visibility: 'sealed', group, imports });

export default [
  {
    id: 'go-badge', level: 1,
    reference: `package main

import "strings"

func badge(raw string) string {
	return strings.ToUpper(strings.TrimSpace(raw))
}

func main() {}`,
    tests: [
      example('normalize-badge', String.raw`if got := badge("  Jo \t"); got != "JO" {
	t.Fatal("Trim surrounding spaces and uppercase the name.")
}`),
      sealed('whitespace-and-unicode', 'Edges', String.raw`for input, expected := range map[string]string{
	"": "", " \r\n\t ": "", "\u2003éloïse\u00a0": "ÉLOÏSE", " a b ": "A B",
} {
	if got := badge(input); got != expected { t.Fatal("Unexpected badge text.") }
}`),
    ],
  },
  {
    id: 'go-parse-count', level: 2,
    reference: `package main

import (
	"errors"
	"strconv"
	"strings"
)

func parseCount(raw string) (int, error) {
	count, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil { return 0, err }
	if count < 0 { return 0, errors.New("count must be nonnegative") }
	return count, nil
}

func main() {}`,
    tests: [
      example('parse-zero-and-positive', `for input, expected := range map[string]int{"0": 0, " 12 ": 12} {
	if got, err := parseCount(input); got != expected || err != nil { t.Fatal("Expected a valid nonnegative count.") }
}`),
      sealed('decimal-syntax-and-sign', 'Validation', String.raw`for _, input := range []string{"", " \t", "0x10", "2.0", "-1", "1 2", "12cats"} {
	if got, err := parseCount(input); got != 0 || err == nil { t.Fatal("Expected an invalid count.") }
}
for input, expected := range map[string]int{"+2": 2, "08": 8, "-0": 0} {
	if got, err := parseCount(input); got != expected || err != nil { t.Fatal("Expected a decimal count.") }
}`),
      sealed('overflow', 'Edges', `if got, err := parseCount("999999999999999999999999999999"); got != 0 || err == nil {
	t.Fatal("An overflowing count must return zero and an error.")
}`),
    ],
  },
  {
    id: 'go-is-ready', level: 3,
    reference: `package main

func isReady(states []string) bool {
	for _, state := range states {
		if state != "ready" { return false }
	}
	return true
}

func main() {}`,
    tests: [
      example('all-ready', `if !isReady([]string{"ready", "ready"}) || isReady([]string{"ready", "waiting"}) {
	t.Fatal("Departure requires every state to be ready.")
}`),
      sealed('empty-and-exact-match', 'Edges', `if !isReady(nil) || !isReady([]string{}) { t.Fatal("The empty group is ready.") }
for _, state := range []string{"Ready", " ready", "", "blocked"} {
	if isReady([]string{"ready", state, "ready"}) { t.Fatal("Only the exact ready state qualifies.") }
}`),
    ],
  },
  {
    id: 'go-with-tag', level: 4,
    reference: `package main

func withTag(tags []string, tag string) []string {
	result := make([]string, len(tags)+1)
	copy(result, tags)
	result[len(tags)] = tag
	return result
}

func main() {}`,
    tests: [
      example('append-new-tag', `got := withTag([]string{"north"}, "medic")
if len(got) != 2 || got[0] != "north" || got[1] != "medic" { t.Fatal("Keep the old tags and append the new one.") }`),
      sealed('independent-storage', 'Ownership', `backing := []string{"north", "spare"}
input := backing[:1]
got := withTag(input, "medic")
if len(got) != 2 || got[0] != "north" || got[1] != "medic" || backing[1] != "spare" {
	t.Fatal("The result must not reuse the spare input capacity.")
}
got[0] = "changed"
if input[0] != "north" { t.Fatal("The result must have independent storage.") }
empty := withTag(backing[:0], "first")
if len(empty) != 1 || empty[0] != "first" || backing[0] != "north" { t.Fatal("An empty input can still alias a backing array.") }`),
      sealed('nil-tags', 'Edges', `got := withTag(nil, "")
if len(got) != 1 || got[0] != "" { t.Fatal("A nil input still produces the supplied tag.") }`),
    ],
  },
  {
    id: 'go-tally', level: 5,
    reference: `package main

func tally(items []string) map[string]int {
	counts := make(map[string]int)
	for _, item := range items {
		if item != "" { counts[item]++ }
	}
	return counts
}

func main() {}`,
    tests: [
      example('count-repeated-items', `got := tally([]string{"a", "b", "a", ""})
if len(got) != 2 || got["a"] != 2 || got["b"] != 1 { t.Fatal("Count repeated keys and skip empty strings.") }`),
      sealed('literal-keys', 'Validation', `got := tally([]string{"A", "a", " a", "a ", " ", "", "A"})
if len(got) != 5 || got["A"] != 2 || got["a"] != 1 || got[" a"] != 1 || got["a "] != 1 || got[" "] != 1 {
	t.Fatal("Case and whitespace are part of each nonempty key.")
}`),
      sealed('empty-map-is-non-nil', 'Edges', `for _, input := range [][]string{nil, {}, {"", ""}} {
	got := tally(input)
	if got == nil || len(got) != 0 { t.Fatal("Return a non-nil empty map.") }
}`),
    ],
  },
  {
    id: 'go-new-hero', level: 6,
    reference: `package main

import (
	"errors"
	"strings"
)

type Hero struct {
	Name string
	XP   int
}

func NewHero(raw string) (Hero, error) {
	name := strings.TrimSpace(raw)
	if name == "" { return Hero{}, errors.New("name is blank") }
	return Hero{Name: name}, nil
}

func main() {}`,
    tests: [
      example('construct-zero-xp-hero', `hero, err := NewHero("  Jo  ")
if err != nil || hero != (Hero{Name: "Jo", XP: 0}) { t.Fatal("Use the trimmed name and start with zero XP.") }`),
      sealed('blank-and-preserved-name', 'Validation', String.raw`for _, raw := range []string{"", " \t\n", "\u2003"} {
	hero, err := NewHero(raw)
	if hero != (Hero{}) || err == nil { t.Fatal("Blank names require the zero hero and an error.") }
}
hero, err := NewHero("\u2003Éloïse Vale\u00a0")
if err != nil || hero != (Hero{Name: "Éloïse Vale"}) { t.Fatal("Keep the name's case and inner spaces.") }`),
    ],
  },
  {
    id: 'go-decode-hero', level: 7,
    reference: `package main

import (
	"encoding/json"
	"errors"
	"strings"
)

type Hero struct {
	Name string \`json:"name"\`
	XP   int    \`json:"xp"\`
}

func decodeHero(raw string) (Hero, error) {
	var hero Hero
	if err := json.Unmarshal([]byte(raw), &hero); err != nil { return Hero{}, err }
	hero.Name = strings.TrimSpace(hero.Name)
	if hero.Name == "" || hero.XP < 0 { return Hero{}, errors.New("invalid hero") }
	return hero, nil
}

func main() {}`,
    tests: [
      example('decode-name-with-default-xp', String.raw`hero, err := decodeHero("{\"name\":\"  Jo  \"}")
if err != nil || hero != (Hero{Name: "Jo"}) { t.Fatal("Trim the name and default missing XP to zero.") }`),
      sealed('reject-invalid-hero-input', 'Validation', String.raw`for _, raw := range []string{
	"{", "[]", "null", "1", "{}", "{\"name\":\"  \"}", "{\"name\":2}", "{\"name\":\"A\",\"xp\":-1}",
	"{\"name\":\"A\",\"xp\":\"1\"}", "{\"name\":\"A\",\"xp\":1.5}", "{\"name\":\"A\"}{}",
} {
	hero, err := decodeHero(raw)
	if hero != (Hero{}) || err == nil { t.Fatal("Reject invalid input with a zero hero and an error.") }
}`),
      sealed('allow-unknown-fields', 'Edges', String.raw`hero, err := decodeHero("{\"name\":\" Mira \",\"xp\":7,\"extra\":true}")
if err != nil || hero != (Hero{Name: "Mira", XP: 7}) { t.Fatal("Unknown fields do not invalidate a hero.") }`),
    ],
  },
  {
    id: 'go-read-name', level: 8,
    reference: `package main

import (
	"errors"
	"io"
	"strings"
)

func ReadName(r io.Reader) (string, error) {
	data, err := io.ReadAll(r)
	if err != nil { return "", err }
	name := strings.TrimSpace(string(data))
	if name == "" { return "", errors.New("name is blank") }
	return name, nil
}

func main() {}`,
    tests: [
      example('read-and-trim-name', String.raw`name, err := ReadName(strings.NewReader("  Mira\n"))
if err != nil || name != "Mira" { t.Fatal("Read and trim the supplied name.") }`, ['strings']),
      sealed('read-to-eof', 'Reader Contract', String.raw`reader := iotest.OneByteReader(strings.NewReader("\tÉloïse Vale \n"))
name, err := ReadName(reader)
if err != nil || name != "Éloïse Vale" { t.Fatal("Read to EOF even if each read returns only one byte.") }`, ['strings', 'testing/iotest']),
      sealed('discard-partial-data-on-error', 'Errors', String.raw`reader := io.MultiReader(strings.NewReader("half"), iotest.ErrReader(errors.New("reader failed")))
name, err := ReadName(reader)
if err == nil || name != "" { t.Fatal("A read failure must return an empty name and an error.") }
name, err = ReadName(strings.NewReader(" \t\n"))
if err == nil || name != "" { t.Fatal("A blank name must return an error.") }`, ['errors', 'io', 'strings', 'testing/iotest']),
    ],
  },
  {
    id: 'go-open-gate', level: 9,
    reference: `package main

import (
	"errors"
	"fmt"
)

var ErrSealed = errors.New("gate is sealed")

func openGate(name string, hasKey bool) error {
	if hasKey { return nil }
	return fmt.Errorf("%s: %w", name, ErrSealed)
}

func main() {}`,
    tests: [
      example('key-opens-gate', `if err := openGate("North", true); err != nil { t.Fatal("The key opens the gate.") }`),
      sealed('wraps-sentinel-and-name', 'Errors', `for _, name := range []string{"West Gate", "河口"} {
	err := openGate(name, false)
	if err == nil || !errors.Is(err, ErrSealed) || !strings.Contains(err.Error(), name) {
		t.Fatal("The error must name the gate and preserve the sentinel under errors.Is.")
	}
}`, ['errors', 'strings']),
    ],
  },
  {
    id: 'go-clamp', level: 10,
    reference: `package main

import "errors"

func clamp(value, low, high int) (int, error) {
	if low > high { return 0, errors.New("invalid interval") }
	if value < low { return low, nil }
	if value > high { return high, nil }
	return value, nil
}

func main() {}`,
    tests: [
      example('inside-and-outside', `for _, trial := range []struct{ value, want int }{{2, 3}, {5, 5}, {10, 8}} {
	if got, err := clamp(trial.value, 3, 8); err != nil || got != trial.want {
		t.Fatal("Clamp a value to the inclusive interval.")
	}
}`),
      sealed('interval-edges', 'Edges', `for _, trial := range []struct{ value, low, high, want int }{
	{-10, -10, -1, -10}, {-1, -10, -1, -1}, {-5, -2, -2, -2}, {6, 0, 0, 0},
} {
	if got, err := clamp(trial.value, trial.low, trial.high); err != nil || got != trial.want { t.Fatal("Unexpected clamped value.") }
}`),
      sealed('reject-reversed-interval', 'Errors', `for _, value := range []int{-2, 5, 19} {
	if got, err := clamp(value, 9, 1); got != 0 || err == nil { t.Fatal("Reversed bounds require zero and an error.") }
}`),
    ],
  },
  {
    id: 'go-square-all', level: 11,
    reference: `package main

func squareAll(nums []int) []int {
	squares := make(chan int)
	go func() {
		defer close(squares)
		for _, number := range nums { squares <- number * number }
	}()
	result := make([]int, 0, len(nums))
	for square := range squares { result = append(result, square) }
	return result
}

func main() {}`,
    tests: [
      example('squares-in-order', `if !slices.Equal(squareAll([]int{2, 1, 3}), []int{4, 1, 9}) {
	t.Fatal("Collect each square in the input order.")
}`, ['slices']),
      sealed('negatives-zero-and-empty', 'Edges', `if !slices.Equal(squareAll([]int{-3, 0, -1, 2, -3}), []int{9, 0, 1, 4, 9}) {
	t.Fatal("Preserve input order and repeated values.")
}
if len(squareAll(nil)) != 0 || len(squareAll([]int{})) != 0 { t.Fatal("Empty input produces an empty result.") }`, ['slices']),
    ],
  },
  {
    id: 'go-wait-for-rune', level: 12,
    reference: `package main

import (
	"context"
	"io"
)

func waitForRune(ctx context.Context, signals <-chan string) (string, error) {
	if err := ctx.Err(); err != nil { return "", err }
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case signal, ok := <-signals:
		if !ok { return "", io.EOF }
		return signal, nil
	}
}

func main() {}`,
    tests: [
      example('receive-a-signal', `signals := make(chan string, 1)
signals <- "rune"
if value, err := waitForRune(context.Background(), signals); value != "rune" || err != nil {
	t.Fatal("Return the received signal.")
}`, ['context']),
      sealed('empty-signal-and-closed-channel', 'Edges', `signals := make(chan string, 1)
signals <- ""
close(signals)
if value, err := waitForRune(context.Background(), signals); value != "" || err != nil { t.Fatal("An empty signal is valid.") }
if value, err := waitForRune(context.Background(), signals); value != "" || err != io.EOF { t.Fatal("A drained closed channel returns EOF.") }`, ['context', 'io']),
      sealed('already-canceled', 'Cancellation', `ctx, cancel := context.WithCancel(context.Background())
cancel()
for index := 0; index < 32; index++ {
	signals := make(chan string, 1)
	signals <- "ready"
	if value, err := waitForRune(ctx, signals); value != "" || err != ctx.Err() || len(signals) != 1 {
		t.Fatal("An already canceled context wins over a ready signal.")
	}
}`, ['context']),
      sealed('cancellation-while-waiting', 'Cancellation', `ctx, cancel := context.WithTimeout(context.Background(), 5*time.Millisecond)
defer cancel()
if value, err := waitForRune(ctx, nil); value != "" || err != context.DeadlineExceeded {
	t.Fatal("Return the context error when waiting for a signal.")
}`, ['context', 'time']),
    ],
  },
  {
    id: 'go-map-values', level: 13,
    reference: `package main

func mapValues[T, U any](items []T, transform func(T) U) []U {
	result := make([]U, len(items))
	for index, item := range items { result[index] = transform(item) }
	return result
}

func main() {}`,
    tests: [
      example('generic-cross-type-map', `got := mapValues([]string{"ab", "", "c"}, func(value string) int { return len(value) })
if !slices.Equal(got, []int{2, 0, 1}) { t.Fatal("Map each string to an integer without reordering it.") }`, ['slices']),
      sealed('once-in-order-and-fresh', 'Callbacks', `input := []int{3, 1, 3}
calls := []int{}
output := mapValues(input, func(value int) int { calls = append(calls, value); return -value })
if !slices.Equal(calls, []int{3, 1, 3}) || !slices.Equal(output, []int{-3, -1, -3}) {
	t.Fatal("Call the transform exactly once per input position in order.")
}
output[0] = 99
if !slices.Equal(input, []int{3, 1, 3}) { t.Fatal("The output must have its own storage.") }`, ['slices']),
      sealed('non-nil-empty', 'Edges', `for _, input := range [][]int{nil, {}} {
	output := mapValues(input, func(int) string { t.Fatal("Empty input must not call transform."); return "" })
	if output == nil || len(output) != 0 { t.Fatal("Return a non-nil empty slice.") }
}`),
    ],
  },
  {
    id: 'go-dispatch', level: 14,
    reference: `package main

import (
	"errors"
	"sync"
)

type Result struct {
	Value int
	Err   error
}

func dispatch(jobs []func() (int, error), limit int) ([]Result, error) {
	if limit < 1 { return nil, errors.New("invalid worker limit") }
	results := make([]Result, len(jobs))
	if len(jobs) == 0 { return results, nil }
	indices := make(chan int)
	var workers sync.WaitGroup
	for worker := 0; worker < min(limit, len(jobs)); worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for index := range indices {
				value, err := jobs[index]()
				results[index] = Result{Value: value, Err: err}
			}
		}()
	}
	for index := range jobs { indices <- index }
	close(indices)
	workers.Wait()
	return results, nil
}

func main() {}`,
    tests: [
      example('retain-job-value-and-error', `problem := errors.New("failed job")
jobs := []func() (int, error){
	func() (int, error) { return 1, nil }, func() (int, error) { return 7, problem }, func() (int, error) { return 3, nil },
}
results, err := dispatch(jobs, 2)
if err != nil || len(results) != 3 || results[0] != (Result{1, nil}) || results[1] != (Result{7, problem}) || results[2] != (Result{3, nil}) {
	t.Fatal("Keep every job's value and error in input order, even after a failure.")
}`, ['errors']),
      sealed('bounded-active-jobs-and-one-call', 'Concurrency', `var active, peak atomic.Int32
hits := make([]atomic.Int32, 8)
jobs := make([]func() (int, error), len(hits))
for index := range jobs {
	i := index
	jobs[i] = func() (int, error) {
		hits[i].Add(1)
		now := active.Add(1)
		defer active.Add(-1)
		for old := peak.Load(); old < now && !peak.CompareAndSwap(old, now); old = peak.Load() {}
		time.Sleep(time.Duration(len(jobs)-i) * time.Millisecond)
		return 5 * i, nil
	}
}
results, err := dispatch(jobs, 2)
if err != nil || len(results) != len(jobs) || peak.Load() > 2 || active.Load() != 0 {
	t.Fatal("Run at most two jobs at once and join every job before returning.")
}
for i, result := range results {
	if hits[i].Load() != 1 || result.Value != 5*i || result.Err != nil { t.Fatal("Run every job once and preserve its input position.") }
}`, ['sync/atomic', 'time']),
      sealed('empty-jobs-and-invalid-limit', 'Errors', `if _, err := dispatch(nil, 0); err == nil { t.Fatal("Validate the limit even for no jobs.") }
called := false
if _, err := dispatch([]func() (int, error){func() (int, error) { called = true; return 0, nil }}, -1); err == nil || called {
	t.Fatal("An invalid limit must not run jobs.")
}
if result, err := dispatch(nil, 100); err != nil || result == nil || len(result) != 0 {
	t.Fatal("A valid empty dispatch returns a non-nil empty slice.")
}`),
    ],
  },
];
