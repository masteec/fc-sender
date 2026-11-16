export class SpintaxEnhancer {
  /**
   * Parsea expresiones de Spintax en el formato {opcion1|opcion2|opcion3}.
   */
  public enrichText(baseText: string): string {
    return this.parseSpintax(baseText || '');
  }

  private parseSpintax(text: string): string {
    const spintaxRegex = /\{([^{}]+)\}/g;
    let match: RegExpExecArray | null;
    let iterations = 0;

    while ((match = spintaxRegex.exec(text)) !== null && iterations < 100) {
      iterations++;
      const options = match[1].split('|');
      const selected = options[Math.floor(Math.random() * options.length)] ?? '';
      text = text.replace(match[0], selected);
      spintaxRegex.lastIndex = 0;
    }

    return text;
  }
}
