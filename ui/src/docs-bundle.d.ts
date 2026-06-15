declare module "virtual:docs-bundle" {
  export interface DocPage {
    id: string;
    title: string;
    section: string;
    html: string;
    text: string;
  }
  export const pages: DocPage[];
}
