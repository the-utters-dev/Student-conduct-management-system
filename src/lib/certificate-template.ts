export type CertificateTokenValues = Record<string, string | number | null | undefined>;

export function renderCertificateTemplateText(text: string, values: CertificateTokenValues) {
  return text.replace(
    /\{\{([a-z_]+)\}\}|\{([a-z_]+)\}/gi,
    (token, doubleBrace: string | undefined, singleBrace: string | undefined) => {
      const key = (doubleBrace ?? singleBrace).toLowerCase();
      const value = values[key];
      return value === undefined || value === null ? token : String(value);
    },
  );
}
