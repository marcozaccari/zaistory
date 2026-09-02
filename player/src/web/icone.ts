/**
 * Le icone: un segno per ogni tipo di risorsa, accanto al nome del campo.
 *
 * I prompt di generazione erano gia' distinti dal colore dell'etichetta, ma il
 * colore da solo chiede di ricordarsi la legenda, e chi legge la storia — non
 * chi la sta collaudando — la legenda non ce l'ha. Una bocca, un altoparlante,
 * una cornice: si capisce a colpo d'occhio se quello che sta scritto li'
 * diventera' una battuta, un rumore o un'inquadratura, che e' l'unica domanda
 * che ci si fa scorrendo il transcript.
 *
 * Sono disegni e non emoji per due ragioni pratiche: le emoji cambiano faccia
 * a ogni sistema (e su qualcuno restano quadrati), e non prendono il colore
 * del testo — mentre qui il segno deve stare *dentro* l'etichetta e prendersi
 * il colore che il tipo di media ha gia'. Con `currentColor` viene gratis.
 *
 * Restano fuori dalla lettura ad alta voce e dagli screen reader
 * (`aria-hidden`): il nome del campo c'e' gia' scritto accanto, e una voce che
 * dicesse «immagine immagine» sarebbe solo rumore.
 */

const NS = 'http://www.w3.org/2000/svg';

/** Il repertorio: nome → tracciati. Solo linee, nessun riempimento. */
const SEGNI: Record<string, string[]> = {
  // Una cornice con l'orizzonte e il sole: l'inquadratura.
  image: ['M3 5h18v14H3z', 'M3 16l5-5 4 4 3-3 6 6', 'M8.5 9.5a1.2 1.2 0 100-2.4 1.2 1.2 0 000 2.4z'],
  // Un altoparlante che emette: il suono d'ambiente e gli effetti.
  sound: ['M4 9v6h4l5 4V5L8 9H4z', 'M16.5 8.5a5 5 0 010 7', 'M19 6a8.5 8.5 0 010 12'],
  // Un paio di labbra: la voce, cioe' qualcuno che parla. L'arco del labbro
  // superiore non e' un vezzo — senza, le due curve simmetriche facevano un
  // occhio, e alla taglia a cui questo segno si guarda davvero era proprio
  // quello che sembrava.
  voice: [
    'M4 12c2-3.6 3.7-5 5-5 1.1 0 1.7 1.3 3 1.3s1.9-1.3 3-1.3c1.3 0 3 1.4 5 5',
    'M4 12c1.6 3.8 4.6 5.6 8 5.6s6.4-1.8 8-5.6',
    'M4 12h16',
  ],
  // Due note unite dalla stampella: la musica.
  music: ['M9 18V6l11-2v12', 'M9 10l11-2', 'M7 20a2 2 0 100-4 2 2 0 000 4z', 'M18 18a2 2 0 100-4 2 2 0 000 4z'],
  // Una testa e le spalle: un personaggio.
  character: ['M12 11.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z', 'M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7'],
  // Uno spillo sulla mappa: un luogo.
  place: ['M12 21c4.7-4.6 7-8.1 7-10.5a7 7 0 10-14 0C5 12.9 7.3 16.4 12 21z', 'M12 12.5a2.2 2.2 0 100-4.4 2.2 2.2 0 000 4.4z'],
  // Tre cursori: lo stile globale, cioe' le regolazioni che valgono ovunque.
  style: ['M4 7h10', 'M18 7h2', 'M4 17h4', 'M12 17h8', 'M16 5v4', 'M8 15v4'],
  // Una A con la sua traversa e la riga di base: il carattere. E' l'unico segno
  // di questo repertorio che non stia accanto a un'etichetta ma dentro un
  // bottone, e per questo e' anche l'unico che debba reggersi da solo — una A
  // e' la lettera con cui si mostra un carattere da sempre, e non ha bisogno
  // di essere spiegata.
  font: ['M4 17L11 4l7 13', 'M7 13h8', 'M4 21h16'],
};

export type NomeIcona = keyof typeof SEGNI;

/** Vero se per questo nome c'e' un segno. */
export function esisteIcona(nome: string): boolean {
  return nome in SEGNI;
}

/**
 * Il segno, pronto da infilare accanto a un'etichetta.
 *
 * Prende il colore da chi lo ospita: dentro `.label` di un prompt e' gia'
 * quello del tipo di media, e non c'e' una seconda tavolozza da tenere
 * allineata alla prima.
 */
export function icona(nome: string): SVGSVGElement | undefined {
  const tracciati = SEGNI[nome];
  if (!tracciati) return undefined;

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'icona');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  // Il tratto e' spesso per la taglia a cui questi segni si vedono davvero:
  // un'icona alta quindici pixel con un tratto sottile su uno schermo di
  // telefono diventa una macchia grigia.
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of tracciati) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/**
 * Il segno di un gruppo di prompt, dedotto dal nome che il gruppo ha nell'IR.
 *
 * Il nome e' gia' quello del campo (`characters.laura`, `places.spaccio`,
 * `global_style`): dedurne l'icona da li' evita di dover passare un tipo in
 * piu' da ogni chiamata, e soprattutto evita che i due dati possano divergere.
 */
export function iconaGruppo(nome: string): SVGSVGElement | undefined {
  if (nome.startsWith('characters.')) return icona('character');
  if (nome.startsWith('places.') || nome === 'background') return icona('place');
  if (nome === 'global_style') return icona('style');
  return undefined;
}
