package models

import (
	"context"
	"errors"
	"log"

	"github.com/cloudwego/eino-ext/components/model/claude"
	"github.com/cloudwego/eino-ext/components/model/openai"
	"github.com/cloudwego/eino/components/model"
	"github.com/spf13/viper"
)

type (
	ModelID       string
	ModelProvider string
)

type Model struct {
	ID           ModelID       `json:"id"`
	Name         string        `json:"name"`
	Provider     ModelProvider `json:"provider"`
	APIModel     string        `json:"api_model"`
	CostPer1MIn  float64       `json:"cost_per_1m_in"`
	CostPer1MOut float64       `json:"cost_per_1m_out"`
}

const (
	DefaultBigModel    = GPT4oMini
	DefaultLittleModel = GPT4oMini
)

// Model IDs
const (
	// OpenAI
	GPT4o     ModelID = "gpt-4o"
	GPT4oMini ModelID = "gpt-4o-mini"
	GPT45     ModelID = "gpt-4.5"
	O1        ModelID = "o1"
	O1Mini    ModelID = "o1-mini"
	// Anthropic
	Claude35Sonnet ModelID = "claude-3.5-sonnet"
	Claude3Haiku   ModelID = "claude-3-haiku"
	Claude37Sonnet ModelID = "claude-3.7-sonnet"
	// Google
	Gemini20Pro   ModelID = "gemini-2.0-pro"
	Gemini15Flash ModelID = "gemini-1.5-flash"
	Gemini20Flash ModelID = "gemini-2.0-flash"
	// xAI
	Grok3     ModelID = "grok-3"
	Grok2Mini ModelID = "grok-2-mini"
	// DeepSeek
	DeepSeekR1    ModelID = "deepseek-r1"
	DeepSeekCoder ModelID = "deepseek-coder"
	// Meta
	Llama3    ModelID = "llama-3"
	Llama270B ModelID = "llama-2-70b"
	// GROQ
	GroqLlama3SpecDec ModelID = "groq-llama-3-spec-dec"
	GroqQwen32BCoder  ModelID = "qwen-2.5-coder-32b"
)

const (
	ProviderOpenAI    ModelProvider = "openai"
	ProviderAnthropic ModelProvider = "anthropic"
	ProviderGoogle    ModelProvider = "google"
	ProviderXAI       ModelProvider = "xai"
	ProviderDeepSeek  ModelProvider = "deepseek"
	ProviderMeta      ModelProvider = "meta"
	ProviderGroq      ModelProvider = "groq"
)

var SupportedModels = map[ModelID]Model{
	// OpenAI
	GPT4o: {
		ID:       GPT4o,
		Name:     "GPT-4o",
		Provider: ProviderOpenAI,
		APIModel: "gpt-4o",
	},
	GPT4oMini: {
		ID:           GPT4oMini,
		Name:         "GPT-4o Mini",
		Provider:     ProviderOpenAI,
		APIModel:     "gpt-4o-mini",
		CostPer1MIn:  0.150,
		CostPer1MOut: 0.600,
	},
	GPT45: {
		ID:       GPT45,
		Name:     "GPT-4.5",
		Provider: ProviderOpenAI,
		APIModel: "gpt-4.5",
	},
	O1: {
		ID:       O1,
		Name:     "o1",
		Provider: ProviderOpenAI,
		APIModel: "o1",
	},
	O1Mini: {
		ID:       O1Mini,
		Name:     "o1 Mini",
		Provider: ProviderOpenAI,
		APIModel: "o1-mini",
	},
	// Anthropic
	Claude35Sonnet: {
		ID:       Claude35Sonnet,
		Name:     "Claude 3.5 Sonnet",
		Provider: ProviderAnthropic,
		APIModel: "claude-3.5-sonnet",
	},
	Claude3Haiku: {
		ID:       Claude3Haiku,
		Name:     "Claude 3 Haiku",
		Provider: ProviderAnthropic,
		APIModel: "claude-3-haiku",
	},
	Claude37Sonnet: {
		ID:       Claude37Sonnet,
		Name:     "Claude 3.7 Sonnet",
		Provider: ProviderAnthropic,
		APIModel: "claude-3-7-sonnet-20250219",
	},
	// Google
	Gemini20Pro: {
		ID:       Gemini20Pro,
		Name:     "Gemini 2.0 Pro",
		Provider: ProviderGoogle,
		APIModel: "gemini-2.0-pro",
	},
	Gemini15Flash: {
		ID:       Gemini15Flash,
		Name:     "Gemini 1.5 Flash",
		Provider: ProviderGoogle,
		APIModel: "gemini-1.5-flash",
	},
	Gemini20Flash: {
		ID:       Gemini20Flash,
		Name:     "Gemini 2.0 Flash",
		Provider: ProviderGoogle,
		APIModel: "gemini-2.0-flash",
	},
	// xAI
	Grok3: {
		ID:       Grok3,
		Name:     "Grok 3",
		Provider: ProviderXAI,
		APIModel: "grok-3",
	},
	Grok2Mini: {
		ID:       Grok2Mini,
		Name:     "Grok 2 Mini",
		Provider: ProviderXAI,
		APIModel: "grok-2-mini",
	},
	// DeepSeek
	DeepSeekR1: {
		ID:       DeepSeekR1,
		Name:     "DeepSeek R1",
		Provider: ProviderDeepSeek,
		APIModel: "deepseek-r1",
	},
	DeepSeekCoder: {
		ID:       DeepSeekCoder,
		Name:     "DeepSeek Coder",
		Provider: ProviderDeepSeek,
		APIModel: "deepseek-coder",
	},
	// Meta
	Llama3: {
		ID:       Llama3,
		Name:     "LLaMA 3",
		Provider: ProviderMeta,
		APIModel: "llama-3",
	},
	Llama270B: {
		ID:       Llama270B,
		Name:     "LLaMA 2 70B",
		Provider: ProviderMeta,
		APIModel: "llama-2-70b",
	},

	// GROQ
	GroqLlama3SpecDec: {
		ID:       GroqLlama3SpecDec,
		Name:     "GROQ LLaMA 3 SpecDec",
		Provider: ProviderGroq,
		APIModel: "llama-3.3-70b-specdec",
	},
	GroqQwen32BCoder: {
		ID:       GroqQwen32BCoder,
		Name:     "GROQ Qwen 2.5 Coder 32B",
		Provider: ProviderGroq,
		APIModel: "qwen-2.5-coder-32b",
	},
}

func GetModel(ctx context.Context, model ModelID) (model.ChatModel, error) {
	provider := SupportedModels[model].Provider
	log.Printf("Provider: %s", provider)
	maxTokens := viper.GetInt("providers.common.max_tokens")
	switch provider {
	case ProviderOpenAI:
		return openai.NewChatModel(ctx, &openai.ChatModelConfig{
			APIKey:    viper.GetString("providers.openai.key"),
			Model:     string(SupportedModels[model].APIModel),
			MaxTokens: &maxTokens,
		})
	case ProviderAnthropic:
		return claude.NewChatModel(ctx, &claude.Config{
			APIKey:    viper.GetString("providers.anthropic.key"),
			Model:     string(SupportedModels[model].APIModel),
			MaxTokens: maxTokens,
		})

	case ProviderGroq:
		return openai.NewChatModel(ctx, &openai.ChatModelConfig{
			BaseURL:   "https://api.groq.com/openai/v1",
			APIKey:    viper.GetString("providers.groq.key"),
			Model:     string(SupportedModels[model].APIModel),
			MaxTokens: &maxTokens,
		})

	}
	return nil, errors.New("unsupported provider")
}
