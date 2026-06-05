// memory/tokenizer.ts
// Lightweight word-level tokenizer with stop-word filtering.

const STOP_WORDS = new Set([
  "a","an","and","are","as","at","be","by","for","from","has","he","in","is","it",
  "its","of","on","that","the","to","was","were","will","with","this","but","or",
  "not","i","you","we","they","them","their","there","what","when","where","which",
  "who","why","how","all","any","some","no","nor","so","if","then","than","into",
  "out","up","down","over","under","again","further","once","here","these","those",
  "do","does","did","can","could","should","would","will","may","might","must",
  "shall","about","above","below","through","during","before","after","between",
  "is","am","been","being","have","had","having",
]);

export function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

export function bigrams(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    out.push(`${tokens[i]}_${tokens[i + 1]}`);
  }
  return out;
}

export function ngrams(tokens: string[], n: number): string[] {
  if (n <= 1) return tokens;
  const out: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    out.push(tokens.slice(i, i + n).join("_"));
  }
  return out;
}
