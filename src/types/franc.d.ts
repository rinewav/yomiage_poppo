declare module 'franc' {
  export function franc(text: string, options?: { minLength?: number }): string;
  export function francAll(text: string, options?: { minLength?: number }): [string, number][];
}
