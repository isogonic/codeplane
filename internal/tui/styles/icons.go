package styles

const (
	OpenCodeIcon string = "ⓒ"

	ErrorIcon   string = "ⓧ"
	WarningIcon string = "ⓦ"
	InfoIcon    string = "ⓘ"
	HintIcon    string = "ⓗ"
	SpinnerIcon string = "⟳"
)

// CircledDigit returns the Unicode circled digit/number for 0‑20.
// out‑of‑range → "".
func CircledDigit(n int) string {
	switch {
	case n == 0:
		return "\u24EA" // ⓪
	case 1 <= n && n <= 20:
		return string(rune(0x2460 + n - 1)) // ①–⑳
	default:
		return ""
	}
}
