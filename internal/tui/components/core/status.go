package core

import (
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/opencode-ai/opencode/internal/config"
	"github.com/opencode-ai/opencode/internal/llm/models"
	"github.com/opencode-ai/opencode/internal/lsp"
	"github.com/opencode-ai/opencode/internal/lsp/protocol"
	"github.com/opencode-ai/opencode/internal/pubsub"
	"github.com/opencode-ai/opencode/internal/session"
	"github.com/opencode-ai/opencode/internal/status"
	"github.com/opencode-ai/opencode/internal/tui/components/chat"
	"github.com/opencode-ai/opencode/internal/tui/styles"
	"github.com/opencode-ai/opencode/internal/tui/theme"
)

type StatusCmp interface {
	tea.Model
	SetHelpWidgetMsg(string)
}

type statusCmp struct {
	statusMessages []statusMessage
	width          int
	messageTTL     time.Duration
	lspClients     map[string]*lsp.Client
	session        session.Session
}

type statusMessage struct {
	Level     status.Level
	Message   string
	Timestamp time.Time
	ExpiresAt time.Time
}

// clearMessageCmd is a command that clears status messages after a timeout
func (m statusCmp) clearMessageCmd() tea.Cmd {
	return tea.Tick(time.Second, func(t time.Time) tea.Msg {
		return statusCleanupMsg{time: t}
	})
}

// statusCleanupMsg is a message that triggers cleanup of expired status messages
type statusCleanupMsg struct {
	time time.Time
}

func (m statusCmp) Init() tea.Cmd {
	return m.clearMessageCmd()
}

func (m statusCmp) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		return m, nil
	case chat.SessionSelectedMsg:
		m.session = msg
	case chat.SessionClearedMsg:
		m.session = session.Session{}
	case pubsub.Event[session.Session]:
		if msg.Type == session.EventSessionUpdated {
			if m.session.ID == msg.Payload.ID {
				m.session = msg.Payload
			}
		}
	case pubsub.Event[status.StatusMessage]:
		if msg.Type == status.EventStatusPublished {
			statusMsg := statusMessage{
				Level:     msg.Payload.Level,
				Message:   msg.Payload.Message,
				Timestamp: msg.Payload.Timestamp,
				ExpiresAt: msg.Payload.Timestamp.Add(m.messageTTL),
			}
			m.statusMessages = append(m.statusMessages, statusMsg)
		}
	case statusCleanupMsg:
		// Remove expired messages
		var activeMessages []statusMessage
		for _, sm := range m.statusMessages {
			if sm.ExpiresAt.After(msg.time) {
				activeMessages = append(activeMessages, sm)
			}
		}
		m.statusMessages = activeMessages
		return m, m.clearMessageCmd()
	}
	return m, nil
}

var helpWidget = ""

// getHelpWidget returns the help widget with current theme colors
func getHelpWidget(helpText string) string {
	t := theme.CurrentTheme()
	if helpText == "" {
		helpText = "ctrl+? help"
	}

	return styles.Padded().
		Background(t.TextMuted()).
		Foreground(t.BackgroundDarker()).
		Bold(true).
		Render(helpText)
}

func formatTokensAndCost(tokens int64, contextWindow int64, cost float64) string {
	// Format tokens in human-readable format (e.g., 110K, 1.2M)
	var formattedTokens string
	switch {
	case tokens >= 1_000_000:
		formattedTokens = fmt.Sprintf("%.1fM", float64(tokens)/1_000_000)
	case tokens >= 1_000:
		formattedTokens = fmt.Sprintf("%.1fK", float64(tokens)/1_000)
	default:
		formattedTokens = fmt.Sprintf("%d", tokens)
	}

	// Remove .0 suffix if present
	if strings.HasSuffix(formattedTokens, ".0K") {
		formattedTokens = strings.Replace(formattedTokens, ".0K", "K", 1)
	}
	if strings.HasSuffix(formattedTokens, ".0M") {
		formattedTokens = strings.Replace(formattedTokens, ".0M", "M", 1)
	}

	// Format cost with $ symbol and 2 decimal places
	formattedCost := fmt.Sprintf("$%.2f", cost)

	percentage := (float64(tokens) / float64(contextWindow)) * 100

	return fmt.Sprintf("Tokens: %s (%d%%), Cost: %s", formattedTokens, int(percentage), formattedCost)
}

func (m statusCmp) View() string {
	t := theme.CurrentTheme()
	modelID := config.Get().Agents[config.AgentCoder].Model
	model := models.SupportedModels[modelID]

	// Initialize the help widget
	status := getHelpWidget("")

	if m.session.ID != "" {
		tokens := formatTokensAndCost(m.session.PromptTokens+m.session.CompletionTokens, model.ContextWindow, m.session.Cost)
		tokensStyle := styles.Padded().
			Background(t.Text()).
			Foreground(t.BackgroundSecondary()).
			Render(tokens)
		status += tokensStyle
	}

	diagnostics := styles.Padded().Background(t.BackgroundDarker()).Render(m.projectDiagnostics())

	modelName := m.model()

	statusWidth := max(
		0,
		m.width-
			lipgloss.Width(status)-
			lipgloss.Width(modelName)-
			lipgloss.Width(diagnostics),
	)

	// Display the first status message if available
	if len(m.statusMessages) > 0 {
		sm := m.statusMessages[0]
		infoStyle := styles.Padded().
			Foreground(t.Background()).
			Width(statusWidth)

		switch sm.Level {
		case "info":
			infoStyle = infoStyle.Background(t.Info())
		case "warn":
			infoStyle = infoStyle.Background(t.Warning())
		case "error":
			infoStyle = infoStyle.Background(t.Error())
		case "debug":
			infoStyle = infoStyle.Background(t.TextMuted())
		}

		// Truncate message if it's longer than available width
		msg := sm.Message
		availWidth := statusWidth - 10
		if len(msg) > availWidth && availWidth > 0 {
			msg = msg[:availWidth] + "..."
		}

		status += infoStyle.Render(msg)
	} else {
		status += styles.Padded().
			Foreground(t.Text()).
			Background(t.BackgroundSecondary()).
			Width(statusWidth).
			Render("")
	}

	status += diagnostics
	status += modelName
	return status
}

func (m *statusCmp) projectDiagnostics() string {
	t := theme.CurrentTheme()

	// Check if any LSP server is still initializing
	initializing := false
	for _, client := range m.lspClients {
		if client.GetServerState() == lsp.StateStarting {
			initializing = true
			break
		}
	}

	// If any server is initializing, show that status
	if initializing {
		return lipgloss.NewStyle().
			Foreground(t.Warning()).
			Render(fmt.Sprintf("%s Initializing LSP...", styles.SpinnerIcon))
	}

	errorDiagnostics := []protocol.Diagnostic{}
	warnDiagnostics := []protocol.Diagnostic{}
	hintDiagnostics := []protocol.Diagnostic{}
	infoDiagnostics := []protocol.Diagnostic{}
	for _, client := range m.lspClients {
		for _, d := range client.GetDiagnostics() {
			for _, diag := range d {
				switch diag.Severity {
				case protocol.SeverityError:
					errorDiagnostics = append(errorDiagnostics, diag)
				case protocol.SeverityWarning:
					warnDiagnostics = append(warnDiagnostics, diag)
				case protocol.SeverityHint:
					hintDiagnostics = append(hintDiagnostics, diag)
				case protocol.SeverityInformation:
					infoDiagnostics = append(infoDiagnostics, diag)
				}
			}
		}
	}

	diagnostics := []string{}

	errStr := lipgloss.NewStyle().
		Background(t.BackgroundDarker()).
		Foreground(t.Error()).
		Render(fmt.Sprintf("%s %d", styles.ErrorIcon, len(errorDiagnostics)))
	diagnostics = append(diagnostics, errStr)

	warnStr := lipgloss.NewStyle().
		Background(t.BackgroundDarker()).
		Foreground(t.Warning()).
		Render(fmt.Sprintf("%s %d", styles.WarningIcon, len(warnDiagnostics)))
	diagnostics = append(diagnostics, warnStr)

	infoStr := lipgloss.NewStyle().
		Background(t.BackgroundDarker()).
		Foreground(t.Info()).
		Render(fmt.Sprintf("%s %d", styles.InfoIcon, len(infoDiagnostics)))
	diagnostics = append(diagnostics, infoStr)

	hintStr := lipgloss.NewStyle().
		Background(t.BackgroundDarker()).
		Foreground(t.Text()).
		Render(fmt.Sprintf("%s %d", styles.HintIcon, len(hintDiagnostics)))
	diagnostics = append(diagnostics, hintStr)

	return styles.ForceReplaceBackgroundWithLipgloss(
		styles.Padded().Render(strings.Join(diagnostics, " ")),
		t.BackgroundDarker(),
	)
}

func (m statusCmp) model() string {
	t := theme.CurrentTheme()

	cfg := config.Get()

	coder, ok := cfg.Agents[config.AgentCoder]
	if !ok {
		return "Unknown"
	}
	model := models.SupportedModels[coder.Model]

	return styles.Padded().
		Background(t.Secondary()).
		Foreground(t.Background()).
		Render(model.Name)
}

func (m statusCmp) SetHelpWidgetMsg(s string) {
	// Update the help widget text using the getHelpWidget function
	helpWidget = getHelpWidget(s)
}

func NewStatusCmp(lspClients map[string]*lsp.Client) StatusCmp {
	// Initialize the help widget with default text
	helpWidget = getHelpWidget("")

	statusComponent := &statusCmp{
		statusMessages: []statusMessage{},
		messageTTL:     4 * time.Second,
		lspClients:     lspClients,
	}

	return statusComponent
}
