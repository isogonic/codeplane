# OpenCode Development Context

## Build Commands
- Build: `go build`
- Run: `go run main.go`
- Test: `go test ./...`
- Test single package: `go test ./internal/package/...`
- Test single test: `go test ./internal/package -run TestName`
- Verbose test: `go test -v ./...`
- Coverage: `go test -cover ./...`
- Lint: `go vet ./...`
- Format: `go fmt ./...`
- Build snapshot: `./scripts/snapshot`

## Code Style
- Use Go 1.24+ features
- Follow standard Go formatting (gofmt)
- Use table-driven tests with t.Parallel() when possible
- Error handling: check errors immediately, return early
- Naming: CamelCase for exported, camelCase for unexported
- Imports: standard library first, then external, then internal
- Use context.Context for cancellation and timeouts
- Prefer interfaces for dependencies to enable testing
- Use testify for assertions in tests