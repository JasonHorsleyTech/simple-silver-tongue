/**
 * Model entries copied verbatim from the live Venice GET /models response (2026-10-13 and 2026-10-14), so the
 * mock speaks the real shape. All are curated (src/venice/curated.ts), so models.list shows them in mock mode
 * too. Text: one with reasoning effort levels, one with no reasoning, one that reasons with no effort levels
 * (reasoning off is disable_thinking). Image: one of each way of sizing and pricing an image, width × height
 * at a flat price (z-image-turbo), resolution and aspect ratio priced per resolution (krea-2-turbo), aspect
 * ratio only at a flat price (hunyuan-image-v3), and resolution priced per quality (grok-imagine-image-2-0).
 */
export const MOCK_MODELS: Array<Record<string, any>> = [
  {
    "context_length": 1000000,
    "created": 1788998400,
    "id": "deepseek-v4-1-flash",
    "model_spec": {
      "pricing": {
        "input": {
          "usd": 0.3,
          "diem": 0.3
        },
        "cache_input": {
          "usd": 0.0075,
          "diem": 0.0075
        },
        "output": {
          "usd": 1.2,
          "diem": 1.2
        }
      },
      "availableContextTokens": 1000000,
      "maxCompletionTokens": 131072,
      "capabilities": {
        "optimizedForCode": true,
        "quantization": "fp8",
        "supportsAudioInput": false,
        "supportsFunctionCalling": true,
        "supportsLogProbs": false,
        "supportsMultipleImages": true,
        "maxImages": 10,
        "supportsReasoning": true,
        "supportsReasoningEffort": true,
        "reasoningEffortOptions": [
          "none",
          "low",
          "high",
          "max"
        ],
        "defaultReasoningEffort": "high",
        "supportsResponseSchema": true,
        "supportsTeeAttestation": false,
        "supportsE2EE": false,
        "supportsVideoInput": false,
        "supportsVision": true,
        "supportsWebSearch": true,
        "supportsXSearch": false
      },
      "description": "DeepSeek V4.1 Flash is a multimodal Mixture-of-Experts model with 552B backbone parameters (8B active on input, 16B on output) and a 1M-token context window. It natively processes images and text, with strong reasoning, coding, and agentic performance.",
      "name": "DeepSeek V4.1 Flash",
      "modelSource": "https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash",
      "offline": false,
      "privacy": "private",
      "traits": []
    },
    "object": "model",
    "owned_by": "venice.ai",
    "type": "text"
  },
  {
    "context_length": 128000,
    "created": 1775001600,
    "id": "venice-uncensored-1-2",
    "model_spec": {
      "pricing": {
        "input": {
          "usd": 0.2,
          "diem": 0.2
        },
        "output": {
          "usd": 0.9,
          "diem": 0.9
        }
      },
      "model_sets": [
        "venice_recommendations"
      ],
      "availableContextTokens": 128000,
      "maxCompletionTokens": 8192,
      "capabilities": {
        "optimizedForCode": false,
        "quantization": "fp16",
        "supportsAudioInput": false,
        "supportsFunctionCalling": true,
        "supportsLogProbs": false,
        "supportsMultipleImages": true,
        "maxImages": 10,
        "supportsReasoning": false,
        "supportsReasoningEffort": false,
        "supportsResponseSchema": true,
        "supportsTeeAttestation": false,
        "supportsE2EE": false,
        "supportsVideoInput": false,
        "supportsVision": true,
        "supportsWebSearch": true,
        "supportsXSearch": false
      },
      "description": "Venice Uncensored 1.2 is designed for maximum creative freedom and authentic interaction. Built for open-ended exploration, roleplay, and unfiltered dialogue with improved capabilities over 1.1.",
      "name": "Venice Uncensored 1.2",
      "modelSource": "https://huggingface.co/cognitivecomputations/Dolphin-Mistral-24B-Venice-Edition",
      "offline": false,
      "privacy": "private",
      "traits": [
        "most_uncensored"
      ],
      "uncensored": true
    },
    "object": "model",
    "owned_by": "venice.ai",
    "type": "text"
  },
  {
    "context_length": 1000000,
    "created": 1787011200,
    "id": "z-ai-glm-5-3",
    "model_spec": {
      "pricing": {
        "input": {
          "usd": 1.75,
          "diem": 1.75
        },
        "cache_input": {
          "usd": 0.325,
          "diem": 0.325
        },
        "output": {
          "usd": 5.5,
          "diem": 5.5
        }
      },
      "availableContextTokens": 1000000,
      "maxCompletionTokens": 131072,
      "capabilities": {
        "optimizedForCode": true,
        "quantization": "not-available",
        "supportsAudioInput": false,
        "supportsFunctionCalling": true,
        "supportsLogProbs": false,
        "supportsMultipleImages": false,
        "supportsReasoning": true,
        "supportsReasoningEffort": false,
        "supportsResponseSchema": true,
        "supportsTeeAttestation": false,
        "supportsE2EE": false,
        "supportsVideoInput": false,
        "supportsVision": false,
        "supportsWebSearch": true,
        "supportsXSearch": false
      },
      "description": "GLM-5.3 is a large-scale reasoning model from Z.ai, built for complex software engineering and long-horizon agent tasks. It supports text input and output with a 1M-token context window, and improves on GLM-5.2 in coding and in the balance between performance and token efficiency.",
      "name": "GLM 5.3",
      "modelSource": "https://huggingface.co/zai-org/GLM-5.3",
      "offline": false,
      "privacy": "private",
      "traits": []
    },
    "object": "model",
    "owned_by": "venice.ai",
    "type": "text"
  },
  {
    "created": 1764758779,
    "id": "z-image-turbo",
    "model_spec": {
      "pricing": {
        "generation": {
          "usd": 0.01,
          "diem": 0.01
        },
        "upscale": {
          "2x": {
            "usd": 0.02,
            "diem": 0.02
          },
          "4x": {
            "usd": 0.08,
            "diem": 0.08
          }
        }
      },
      "model_sets": [
        "venice_recommendations"
      ],
      "constraints": {
        "promptCharacterLimit": 7500,
        "steps": {
          "default": 8,
          "max": 8
        },
        "widthHeightDivisor": 8
      },
      "supportsWebSearch": false,
      "supportsOptimizePromptThinking": false,
      "supportsStyleReferences": false,
      "name": "Z-Image Turbo",
      "modelSource": "https://huggingface.co/Tongyi-MAI/Z-Image-Turbo",
      "offline": false,
      "privacy": "private",
      "traits": [
        "default",
        "fastest"
      ]
    },
    "object": "model",
    "owned_by": "venice.ai",
    "type": "image"
  },
  {
    "created": 1782777600,
    "id": "krea-2-turbo",
    "model_spec": {
      "pricing": {
        "resolutions": {
          "1K": {
            "usd": 0.04,
            "diem": 0.04
          },
          "2K": {
            "usd": 0.06,
            "diem": 0.06
          }
        },
        "upscale": {
          "2x": {
            "usd": 0.02,
            "diem": 0.02
          },
          "4x": {
            "usd": 0.08,
            "diem": 0.08
          }
        }
      },
      "model_sets": [
        "venice_recommendations"
      ],
      "constraints": {
        "promptCharacterLimit": 5000,
        "defaultResolution": "1K",
        "resolutions": [
          "1K",
          "2K"
        ],
        "aspectRatios": [
          "1:1",
          "3:2",
          "16:9",
          "21:9",
          "9:16",
          "2:3",
          "3:4",
          "4:5"
        ],
        "defaultAspectRatio": "1:1",
        "steps": {
          "default": 20,
          "max": 50
        },
        "widthHeightDivisor": 1
      },
      "supportsWebSearch": false,
      "supportsOptimizePromptThinking": false,
      "supportsStyleReferences": false,
      "name": "Krea 2 Turbo",
      "offline": false,
      "privacy": "private",
      "traits": [],
      "uncensored": true
    },
    "object": "model",
    "owned_by": "venice.ai",
    "type": "image"
  },
  {
    "created": 1772323200,
    "id": "hunyuan-image-v3",
    "model_spec": {
      "pricing": {
        "generation": {
          "usd": 0.09,
          "diem": 0.09
        },
        "upscale": {
          "2x": {
            "usd": 0.02,
            "diem": 0.02
          },
          "4x": {
            "usd": 0.08,
            "diem": 0.08
          }
        }
      },
      "constraints": {
        "promptCharacterLimit": 3000,
        "aspectRatios": [
          "1:1",
          "3:2",
          "16:9",
          "21:9",
          "9:16",
          "2:3",
          "3:4",
          "4:5"
        ],
        "defaultAspectRatio": "1:1",
        "steps": {
          "default": 20,
          "max": 50
        },
        "widthHeightDivisor": 1
      },
      "supportsWebSearch": false,
      "supportsOptimizePromptThinking": false,
      "supportsStyleReferences": false,
      "name": "Hunyuan Image 3.0",
      "offline": false,
      "privacy": "private",
      "traits": []
    },
    "object": "model",
    "owned_by": "venice.ai",
    "type": "image"
  },
  {
    "created": 1786406400,
    "id": "grok-imagine-image-2-0",
    "model_spec": {
      "pricing": {
        "resolutions": {
          "1K": {
            "usd": 0.07,
            "diem": 0.07
          },
          "2K": {
            "usd": 0.1,
            "diem": 0.1
          }
        },
        "quality": {
          "1K": {
            "low": {
              "usd": 0.05,
              "diem": 0.05
            },
            "medium": {
              "usd": 0.07,
              "diem": 0.07
            }
          },
          "2K": {
            "low": {
              "usd": 0.07,
              "diem": 0.07
            },
            "medium": {
              "usd": 0.1,
              "diem": 0.1
            }
          }
        },
        "upscale": {
          "2x": {
            "usd": 0.02,
            "diem": 0.02
          },
          "4x": {
            "usd": 0.08,
            "diem": 0.08
          }
        }
      },
      "model_sets": [
        "venice_recommendations",
        "featured"
      ],
      "constraints": {
        "promptCharacterLimit": 7500,
        "defaultResolution": "1K",
        "resolutions": [
          "1K",
          "2K"
        ],
        "defaultQuality": "medium",
        "qualities": [
          "low",
          "medium"
        ],
        "aspectRatios": [
          "1:1",
          "16:9",
          "9:16",
          "3:4",
          "3:2",
          "2:3"
        ],
        "defaultAspectRatio": "1:1",
        "steps": {
          "default": 20,
          "max": 50
        },
        "widthHeightDivisor": 1
      },
      "supportsWebSearch": false,
      "supportsOptimizePromptThinking": false,
      "supportsStyleReferences": false,
      "name": "Grok Imagine 2.0",
      "offline": false,
      "privacy": "private",
      "traits": []
    },
    "object": "model",
    "owned_by": "venice.ai",
    "type": "image"
  }
];
