#!/bin/sh
# This script runs inside the isolated Rust container.
set -eu
umask 077

IFS= read -r token
IFS= read -r submission
IFS= read -r tests
printf '%s' "$submission" | base64 --decode > submission.rs
unset submission

control() {
    printf 'FERRUM1 %s %s\n' "$token" "$1"
}

report() {
    control "$1"
    head -c "$3" "$2" | base64 --wrap=0
    printf '\n'
    control done
}

compile() {
    compiler_status=0
    timeout --kill-after=1s 6s /usr/local/cargo/bin/rustc \
        --edition=2024 --error-format=short --color=never -A warnings \
        -C debuginfo=0 -C strip=debuginfo "$@" \
        </dev/null >compiler.log 2>&1 || compiler_status=$?
    case "$compiler_status" in
        0) return ;;
        124|137) control timeout; exit 22 ;;
        *) report compile_error compiler.log 8192; exit 20 ;;
    esac
}

# Build the learner library before trusted test source exists on disk.
compile --crate-type=rlib --crate-name ferrum_submission \
    -o libferrum_submission.rlib submission.rs

printf '%s' "$tests" | base64 --decode > tests.rs
unset tests
cat > harness.rs <<'RUST'
mod ferrum_tests {
    use ferrum_submission::*;
    include!("tests.rs");
}
RUST
compile --test --crate-name ferrum_harness \
    --extern ferrum_submission=libferrum_submission.rlib -o suite harness.rs
rm -- submission.rs tests.rs harness.rs libferrum_submission.rlib compiler.log
control compiled

test_status=0
timeout --kill-after=1s 8s ./suite \
    --exact --format=pretty --color=never --test-threads=1 "$@" \
    </dev/null >suite.log 2>&1 || test_status=$?

case "$test_status" in
    124|137) control timeout; exit 22 ;;
esac

if [ "$(wc -c <suite.log)" -gt 16384 ]; then
    control output_limit
    exit 23
fi

report "tests $test_status" suite.log 16384
if [ "$test_status" -eq 0 ]; then
    exit 0
fi
exit 21
