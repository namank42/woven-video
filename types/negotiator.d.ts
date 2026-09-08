declare module "negotiator" {
  export default class Negotiator {
    constructor(request: { headers: { accept?: string } });
    mediaType(available: readonly string[]): string | undefined;
  }
}
