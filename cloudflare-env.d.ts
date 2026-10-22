interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  ATLASSIAN_CLIENT_ID?: string;
  ATLASSIAN_CLIENT_SECRET?: string;
  TOKEN_ENCRYPTION_KEY?: string;
    LLLM_CONNECTOR_TOKEN?: string;
    LLLM_PUBLIC_KEY?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: {
          format: string;
          quality: number;
        }): Promise<{ response(): Response }>;
      };
    };
  };
}

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ATLASSIAN_CLIENT_ID?: string;
    ATLASSIAN_CLIENT_SECRET?: string;
    TOKEN_ENCRYPTION_KEY?: string;
    LLLM_CONNECTOR_TOKEN?: string;
    LLLM_PUBLIC_KEY?: string;
  }
}
