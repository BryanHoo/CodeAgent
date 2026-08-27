type MockFulfillOptions = Readonly<{
  body?: BodyInit;
  contentType?: string;
  json?: unknown;
  status?: number;
}>;

class MockRequestView {
  private readonly requestUrl: string;
  private readonly requestMethod: string;
  private readonly requestBody: string | null;

  public constructor(
    requestUrl: string,
    requestMethod: string,
    requestBody: string | null,
  ) {
    this.requestUrl = requestUrl;
    this.requestMethod = requestMethod;
    this.requestBody = requestBody;
  }

  public method(): string {
    return this.requestMethod;
  }

  public postData(): string | null {
    return this.requestBody;
  }

  public url(): string {
    return this.requestUrl;
  }
}

export class MockRoute {
  private fulfilledResponse: Response | undefined;
  private readonly requestView: MockRequestView;

  public constructor(url: string, method: string, body: string | null) {
    this.requestView = new MockRequestView(url, method, body);
  }

  public async fulfill(options: MockFulfillOptions): Promise<void> {
    const headers = new Headers();
    if (options.contentType !== undefined) {
      headers.set("content-type", options.contentType);
    }
    const body = options.json === undefined ? options.body : JSON.stringify(options.json);
    this.fulfilledResponse = new Response(body, {
      headers,
      status: options.status ?? 200,
    });
  }

  public request(): MockRequestView {
    return this.requestView;
  }

  public response(): Response {
    if (this.fulfilledResponse === undefined) {
      throw new Error("Mock route did not provide a response");
    }
    return this.fulfilledResponse;
  }
}

export function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const decoded = globalThis.atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}
