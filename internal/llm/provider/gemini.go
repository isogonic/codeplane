package provider

import (
	"context"
	"encoding/json"
	"errors"
	"log"

	"github.com/google/generative-ai-go/genai"
	"github.com/google/uuid"
	"github.com/kujtimiihoxha/termai/internal/llm/models"
	"github.com/kujtimiihoxha/termai/internal/llm/tools"
	"github.com/kujtimiihoxha/termai/internal/message"
	"google.golang.org/api/googleapi"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
)

type geminiProvider struct {
	client        *genai.Client
	model         models.Model
	maxTokens     int32
	apiKey        string
	systemMessage string
}

type GeminiOption func(*geminiProvider)

func NewGeminiProvider(ctx context.Context, opts ...GeminiOption) (Provider, error) {
	provider := &geminiProvider{
		maxTokens: 5000,
	}

	for _, opt := range opts {
		opt(provider)
	}

	if provider.systemMessage == "" {
		return nil, errors.New("system message is required")
	}

	client, err := genai.NewClient(ctx, option.WithAPIKey(provider.apiKey))
	if err != nil {
		return nil, err
	}
	provider.client = client

	return provider, nil
}

func WithGeminiSystemMessage(message string) GeminiOption {
	return func(p *geminiProvider) {
		p.systemMessage = message
	}
}

func WithGeminiMaxTokens(maxTokens int32) GeminiOption {
	return func(p *geminiProvider) {
		p.maxTokens = maxTokens
	}
}

func WithGeminiModel(model models.Model) GeminiOption {
	return func(p *geminiProvider) {
		p.model = model
	}
}

func WithGeminiKey(apiKey string) GeminiOption {
	return func(p *geminiProvider) {
		p.apiKey = apiKey
	}
}

func (p *geminiProvider) Close() {
	if p.client != nil {
		p.client.Close()
	}
}

// convertToGeminiHistory converts the message history to Gemini's format
func (p *geminiProvider) convertToGeminiHistory(messages []message.Message) []*genai.Content {
	var history []*genai.Content

	for _, msg := range messages {
		switch msg.Role {
		case message.User:
			history = append(history, &genai.Content{
				Parts: []genai.Part{genai.Text(msg.Content)},
				Role:  "user",
			})
		case message.Assistant:
			content := &genai.Content{
				Role:  "model",
				Parts: []genai.Part{},
			}

			// Handle regular content
			if msg.Content != "" {
				content.Parts = append(content.Parts, genai.Text(msg.Content))
			}

			// Handle tool calls if any
			if len(msg.ToolCalls) > 0 {
				for _, call := range msg.ToolCalls {
					args, _ := parseJsonToMap(call.Input)
					content.Parts = append(content.Parts, genai.FunctionCall{
						Name: call.Name,
						Args: args,
					})
				}
			}

			history = append(history, content)
		case message.Tool:
			for _, result := range msg.ToolResults {
				// Parse response content to map if possible
				response := map[string]interface{}{"result": result.Content}
				parsed, err := parseJsonToMap(result.Content)
				if err == nil {
					response = parsed
				}
				var toolCall message.ToolCall
				for _, msg := range messages {
					if msg.Role == message.Assistant {
						for _, call := range msg.ToolCalls {
							if call.ID == result.ToolCallID {
								toolCall = call
								break
							}
						}
					}
				}

				history = append(history, &genai.Content{
					Parts: []genai.Part{genai.FunctionResponse{
						Name:     toolCall.Name,
						Response: response,
					}},
					Role: "function",
				})
			}
		}
	}

	return history
}

// convertToolsToGeminiFunctionDeclarations converts tool definitions to Gemini's function declarations
func (p *geminiProvider) convertToolsToGeminiFunctionDeclarations(tools []tools.BaseTool) []*genai.FunctionDeclaration {
	declarations := make([]*genai.FunctionDeclaration, len(tools))

	for i, tool := range tools {
		info := tool.Info()

		// Convert parameters to genai.Schema format
		properties := make(map[string]*genai.Schema)
		for name, param := range info.Parameters {
			// Try to extract type and description from the parameter
			paramMap, ok := param.(map[string]interface{})
			if !ok {
				// Default to string if unable to determine type
				properties[name] = &genai.Schema{Type: genai.TypeString}
				continue
			}

			schemaType := genai.TypeString // Default
			var description string
			var itemsTypeSchema *genai.Schema
			if typeVal, found := paramMap["type"]; found {
				if typeStr, ok := typeVal.(string); ok {
					switch typeStr {
					case "string":
						schemaType = genai.TypeString
					case "number":
						schemaType = genai.TypeNumber
					case "integer":
						schemaType = genai.TypeInteger
					case "boolean":
						schemaType = genai.TypeBoolean
					case "array":
						schemaType = genai.TypeArray
						items, found := paramMap["items"]
						if found {
							itemsMap, ok := items.(map[string]interface{})
							if ok {
								itemsType, found := itemsMap["type"]
								if found {
									itemsTypeStr, ok := itemsType.(string)
									if ok {
										switch itemsTypeStr {
										case "string":
											itemsTypeSchema = &genai.Schema{
												Type: genai.TypeString,
											}
										case "number":
											itemsTypeSchema = &genai.Schema{
												Type: genai.TypeNumber,
											}
										case "integer":
											itemsTypeSchema = &genai.Schema{
												Type: genai.TypeInteger,
											}
										case "boolean":
											itemsTypeSchema = &genai.Schema{
												Type: genai.TypeBoolean,
											}
										}
									}
								}
							}
						}
					case "object":
						schemaType = genai.TypeObject
						if _, found := paramMap["properties"]; !found {
							continue
						}
						// TODO: Add support for other types
					}
				}
			}

			if desc, found := paramMap["description"]; found {
				if descStr, ok := desc.(string); ok {
					description = descStr
				}
			}

			properties[name] = &genai.Schema{
				Type:        schemaType,
				Description: description,
				Items:       itemsTypeSchema,
			}
		}

		declarations[i] = &genai.FunctionDeclaration{
			Name:        info.Name,
			Description: info.Description,
			Parameters: &genai.Schema{
				Type:       genai.TypeObject,
				Properties: properties,
				Required:   info.Required,
			},
		}
	}

	return declarations
}

// extractTokenUsage extracts token usage information from Gemini's response
func (p *geminiProvider) extractTokenUsage(resp *genai.GenerateContentResponse) TokenUsage {
	if resp == nil || resp.UsageMetadata == nil {
		return TokenUsage{}
	}

	return TokenUsage{
		InputTokens:         int64(resp.UsageMetadata.PromptTokenCount),
		OutputTokens:        int64(resp.UsageMetadata.CandidatesTokenCount),
		CacheCreationTokens: 0, // Not directly provided by Gemini
		CacheReadTokens:     int64(resp.UsageMetadata.CachedContentTokenCount),
	}
}

// SendMessages sends a batch of messages to Gemini and returns the response
func (p *geminiProvider) SendMessages(ctx context.Context, messages []message.Message, tools []tools.BaseTool) (*ProviderResponse, error) {
	// Create a generative model
	model := p.client.GenerativeModel(p.model.APIModel)
	model.SetMaxOutputTokens(p.maxTokens)

	// Set system instruction
	model.SystemInstruction = genai.NewUserContent(genai.Text(p.systemMessage))

	// Set up tools if provided
	if len(tools) > 0 {
		declarations := p.convertToolsToGeminiFunctionDeclarations(tools)
		model.Tools = []*genai.Tool{{FunctionDeclarations: declarations}}
	}

	// Create chat session and set history
	chat := model.StartChat()
	chat.History = p.convertToGeminiHistory(messages[:len(messages)-1]) // Exclude last message

	// Get the most recent user message
	var lastUserMsg message.Message
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == message.User {
			lastUserMsg = messages[i]
			break
		}
	}

	// Send the message
	resp, err := chat.SendMessage(ctx, genai.Text(lastUserMsg.Content))
	if err != nil {
		return nil, err
	}

	// Process the response
	var content string
	var toolCalls []message.ToolCall

	if len(resp.Candidates) > 0 && resp.Candidates[0].Content != nil {
		for _, part := range resp.Candidates[0].Content.Parts {
			switch p := part.(type) {
			case genai.Text:
				content = string(p)
			case genai.FunctionCall:
				id := "call_" + uuid.New().String()
				args, _ := json.Marshal(p.Args)
				toolCalls = append(toolCalls, message.ToolCall{
					ID:    id,
					Name:  p.Name,
					Input: string(args),
					Type:  "function",
				})
			}
		}
	}

	// Extract token usage
	tokenUsage := p.extractTokenUsage(resp)

	return &ProviderResponse{
		Content:   content,
		ToolCalls: toolCalls,
		Usage:     tokenUsage,
	}, nil
}

// StreamResponse streams the response from Gemini
func (p *geminiProvider) StreamResponse(ctx context.Context, messages []message.Message, tools []tools.BaseTool) (<-chan ProviderEvent, error) {
	// Create a generative model
	model := p.client.GenerativeModel(p.model.APIModel)
	model.SetMaxOutputTokens(p.maxTokens)

	// Set system instruction
	model.SystemInstruction = genai.NewUserContent(genai.Text(p.systemMessage))

	// Set up tools if provided
	if len(tools) > 0 {
		declarations := p.convertToolsToGeminiFunctionDeclarations(tools)
		for _, declaration := range declarations {
			model.Tools = append(model.Tools, &genai.Tool{FunctionDeclarations: []*genai.FunctionDeclaration{declaration}})
		}
	}

	// Create chat session and set history
	chat := model.StartChat()
	chat.History = p.convertToGeminiHistory(messages[:len(messages)-1]) // Exclude last message

	lastUserMsg := messages[len(messages)-1]

	// Start streaming
	iter := chat.SendMessageStream(ctx, genai.Text(lastUserMsg.Content))

	eventChan := make(chan ProviderEvent)

	go func() {
		defer close(eventChan)

		var finalResp *genai.GenerateContentResponse
		currentContent := ""
		toolCalls := []message.ToolCall{}

		for {
			resp, err := iter.Next()
			if err == iterator.Done {
				break
			}
			if err != nil {
				var apiErr *googleapi.Error
				if errors.As(err, &apiErr) {
					log.Printf("%s", apiErr.Body)
				}
				eventChan <- ProviderEvent{
					Type:  EventError,
					Error: err,
				}
				return
			}

			finalResp = resp

			if len(resp.Candidates) > 0 && resp.Candidates[0].Content != nil {
				for _, part := range resp.Candidates[0].Content.Parts {
					switch p := part.(type) {
					case genai.Text:
						newText := string(p)
						eventChan <- ProviderEvent{
							Type:    EventContentDelta,
							Content: newText,
						}
						currentContent += newText
					case genai.FunctionCall:
						// For function calls, we assume they come complete, not streamed in parts
						id := "call_" + uuid.New().String()
						args, _ := json.Marshal(p.Args)
						newCall := message.ToolCall{
							ID:    id,
							Name:  p.Name,
							Input: string(args),
							Type:  "function",
						}

						// Check if this is a new tool call
						isNew := true
						for _, existing := range toolCalls {
							if existing.Name == newCall.Name && existing.Input == newCall.Input {
								isNew = false
								break
							}
						}

						if isNew {
							toolCalls = append(toolCalls, newCall)
						}
					}
				}
			}
		}

		// Extract token usage from the final response
		tokenUsage := p.extractTokenUsage(finalResp)

		eventChan <- ProviderEvent{
			Type: EventComplete,
			Response: &ProviderResponse{
				Content:   currentContent,
				ToolCalls: toolCalls,
				Usage:     tokenUsage,
			},
		}
	}()

	return eventChan, nil
}

// Helper function to parse JSON string into map
func parseJsonToMap(jsonStr string) (map[string]interface{}, error) {
	var result map[string]interface{}
	err := json.Unmarshal([]byte(jsonStr), &result)
	return result, err
}
