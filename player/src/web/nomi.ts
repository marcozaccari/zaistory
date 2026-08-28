/**
 * I nomi delle cose per chi legge, accanto ai nomi che hanno nell'IR.
 *
 * Il transcript mostrava i campi col nome che hanno nel file — `image_prompt`,
 * `background`, `characters.laura` — ed era la scelta giusta finche' questo era
 * uno strumento di collaudo: il nome del campo e' l'unica cosa che permette di
 * dire «manca l'ambient_sound_prompt di questa scena» invece di «manca un
 * suono, credo». Ma la stessa build adesso si gioca, e a chi gioca
 * `narration_voice.style_prompt` non dice niente: dice solo che sta guardando
 * dentro una macchina.
 *
 * Quindi i nomi diventano due, e nessuno dei due va perso. Fuori dal debug si
 * legge «voce», «inquadratura», «ambiente»; col debug acceso tornano i nomi
 * veri, che sono quelli da citare a chi compila la storia. Stanno **entrambi
 * nel documento** e a scegliere e' il CSS, come per tutta l'altra diagnostica:
 * cosi' accendere il debug non ricostruisce niente e vale anche per il
 * transcript gia' scorso.
 *
 * Una regola per chi aggiunge un campo: se non e' qui, esce col suo nome
 * tecnico anche a chi gioca. Meglio accorgersene aggiungendo una riga a questa
 * tabella che scoprirlo in mezzo a una storia.
 */

/** Un valore che ha una faccia per chi legge e una per chi ispeziona. */
export interface Doppio {
  umano: string;
  ir: string;
}

export function doppio(umano: string, ir: string): Doppio {
  return { umano, ir };
}

/**
 * Nome del campo → nome per chi legge.
 *
 * Diversi campi finiscono sulla stessa parola, ed e' voluto: `voice`,
 * `voice_override` e `narration_voice` sono tre posti da cui puo' arrivare
 * *la voce*, e la differenza fra loro interessa chi compila, non chi ascolta.
 */
const NOMI: Record<string, string> = {
  // Copertina.
  ir_version: 'versione',
  generated_by: 'compilata da',
  id: 'identificativo',
  language: 'lingua',
  scenes: 'scene',
  start_scene: 'prima scena',

  // Stile globale.
  default_tone: 'tono',
  image_style_suffix: 'stile delle immagini',
  'narrator_voice.style_prompt': 'voce del narratore',
  ambient_music_tags: 'musica',

  // Personaggi e luoghi.
  visual_prompt: 'aspetto',
  'voice.style_prompt': 'voce',
  'voice_override.style_prompt': 'voce',
  'narration_voice.style_prompt': 'voce',

  // Scena e inquadrature.
  scene_tone: 'tono',
  place: 'luogo',
  characters_in_frame: 'in campo',
  image_prompt: 'inquadratura',
  ambient_sound_prompt: 'ambiente',
  sound_effect_prompt: 'suono',
  play_sound_prompt: 'suono',

  // Gruppi.
  global_style: 'stile della storia',
  background: 'ambientazione',
};

/** Il tipo di scena, detto a chi gioca invece che allo schema. */
const TIPI_SCENA: Record<string, string> = {
  interactive: 'da giocare',
  cutscene: 'da guardare',
};

export function nomeTipoScena(tipo: string): string {
  return TIPI_SCENA[tipo] ?? tipo;
}

/**
 * Il nome umano di un campo.
 *
 * I campi costruiti attorno a un id — `places.<id>.visual_prompt` — non possono
 * stare in tabella uno per uno: si riconoscono dalla forma. Quello che non si
 * riconosce affatto torna com'e', che e' brutto ma vero: meglio un nome tecnico
 * in chiaro che un nome inventato.
 */
export function nomeCampo(campo: string): string {
  const noto = NOMI[campo];
  if (noto) return noto;
  if (/^places\..+\.visual_prompt$/.test(campo)) return 'aspetto del luogo';
  if (/^characters\./.test(campo)) return 'personaggio';
  if (/^places\./.test(campo)) return 'luogo';
  return campo;
}
