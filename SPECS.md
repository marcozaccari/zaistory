# Specifiche e requisiti

Questo documento fissa i paletti, le regole fondamentali a cui il progetto si deve attenere.
ARCHITECTURE e le scelte implementative emergono di conseguenza, oppure si allineano aderendo alle modifiche di questo file.

## Obiettivi

- Da bozza a storia definitiva: un consulente sceneggiatore che aiuta a completare una sceneggiatura, anche se solo abbozzata.
  Qui basta una skill ben fatta, che può essere usata oppure no.

- Da storia statica a giocabile: un puzzle designer e narrative designer, che aiuta a rendere una storia interattiva, potenzialmente giocabile come una vecchia avventura grafica in stile LucasArts o Sierra.
  Qui occorre una skill che interpreti il testo della sceneggiatura e la converta, iterativamente con l'essere umano, in un file standardizzato e interpretabile formalmente del player.
  Gli enigmi si scelgono qui, come i meccanismi di sblocco di ambienti e azioni, gli oggetti interagibili di scena e di inventario, lo stile delle variazioni nei dialoghi, ecc. 
  
- Un player che riesce a far girare e giocare l'avventura grafica.
  Il player non inventa nulla della storia, si limita a giocarla secondo i meccanismi, i flag e tutte le generazioni delle varianti di gioco.

## Tipologia di gioco

Regia e fotografia creano quell'immersività del background delle scene fatta di immagini, musiche e suoni. Cutscene, cambi di inquadratura, descrizioni, tutto ciò che evoca l'ambiente nel giocatore.

La storia è divisa in capitoli o atti, ognuno dei quali contiene scene e beat, che accadono in un luoghi o ambienti.

Come entità attive ci sono i personaggi in scena, gli oggetti nell'ambiente, gli oggetti nell'inventario.

Il giocatore, che impersona in personaggio della storia (in genere il protagonista), agisce con le entità attive e quindi con l'ambiente, mutando gli stati interni del gioco. 

Gli stati interni del gioco sbloccano scene, oggetti, dialoghi o altri meccanismi, e il gioco termina quando il giocatore riesce ad arrivare fino all'ultima scena e quindi alla fine naturale della storia.

Il tipo di sceneggiatura giocabile stabilisce inoltre se il giocatore può perdere, ovvero giungere in una biforcazione che porta ad un finale alternativo e prematuro della storia (stile Sierra). Oppure se può solo vincere, al massimo rimarrà bloccato temporaneamente cercando di trovare la combinazione di stati giusta (stile LucasArts).

## Regole di gioco

Il giocatore può passare da un luogo all'altro. Ci sono luoghi che dopo certi cambi di stato risulteranno inaccessibili e non più giocabili (completati).

Quando, per mezzo delle scene, si completeranno tutti gli ambienti di un atto, questo si chiuderà e si passerà al prossimo.

Ogni atto è autonomo, ovvero non ci sono relazioni logiche tra un anno e l'altro. L'unica cosa che cambia tra un atto e l'altro sono solo gli oggetti dell'inventario, persi, ceduti o raccolti.
Non è possibile chiudere un atto se prima non si sono raccolti o usati tutti gli oggetti necessari - altrimenti ci sarebbe un blocco logico "non posso usare ciò che non ho preso, e non posso tornare indietro a prenderlo".

## Interattività

### Azioni

Il giocatore agisce con ciò che lo circonda in quattro soli modi: **guarda (percepisci)**, **usa (manipola)**, **parla (comunica)**, **vai (muoviti)**.

I primi tre agiscono sulle entità dentro l'ambiente. Il quarto è di natura diversa e va tenuto distinto: **non agisce su un'entità, cambia l'ambiente**. Per il giocatore però è un verbo come gli altri, e come gli altri va capito quando lo scrive.

Le azioni che divergono troppo da questi quattro macro gruppi hanno un fallback in stile "non posso farlo", "non capisco", ...

Hint: generando molti fallback aumenta l'immersività, ancor meglio se sono fallback contestuali.

#### Azione Guarda (percezione)

Tutto ciò che riguarda la percezione dell'ambiente: guarda, osserva, cerca, senti, annusa, assaggia, vedi, fissa, verifica, controlla, spia, sorveglia, sbircia, scruta, esplora, contempla, ascolta (un luogo o un oggetto)...

Usandolo come verbo singolo e si otterrà la descrizione di default dell'ambiente di scena.
Usandolo con complemento oggetto "osserva oggetto/personaggio" si otterrà una descrizione ancora più dettagliata.

Regole: 

- tutto ciò con cui si interagisce deve essere osservabile.

- se c'è più di un complemento oggetto viene considerato solo il primo.

Hint: generando descrizioni anche di oggetti non interagibili migliora la giocabilità; più dettagli ambientali osservabili aumenta l'immersività.

#### Azione Usa (manipolazione)

Tutto ciò che riguarda l'azione fisica e diretta sull'ambiente: utilizza, attiva, tocca, modifica, sposta, muovi, afferra, prendi, raccogli, lancia, schiaccia, gira, infila, collega, prepara, accendi, rompi... 

Regole: 

- non può essere usato come verbo singolo, necessita almeno di un complemento oggetto.

- si possono avere fino a due complementi oggetti: usa X con Y; dai X a Y, ...

- se ci sono più di due complementi oggetti vengono considerati solo i primi due.

#### Azione Parla (comunicazione)

Tutto ciò che riguarda l'ascolto e la comunicazione: dialoga, racconta, sussurra, urla, ascolta (un personaggio), spiega, informa, avvisa, persuadi, negozia, rimprovera, domanda, commenta, afferma, dichiara, annuncia, insulta, minaccia, provoca, scherza, borbotta, brontola, strilla, chiama, declama, presta attenzione, consulta, ...

Regole:

- può essere usato come verbo singolo solo se c'è un solo dialogo in scena o soltanto un personaggio con cui parlare.

- se c'è più di un complemento oggetto viene considerato solo il primo.

#### Azione Vai (movimento)

Tutto ciò che riguarda lo spostarsi da un ambiente all'altro: vai, esci, entra, vattene, torna, prosegui, avanza, cammina, corri, scappa, fuggi, sali, scendi, arrampicati, salta, attraversa, passa, segui, avvicinati, allontanati, raggiungi, dirigiti, rientra, indietreggia, mappa...

Regole:

- può essere usato come verbo singolo: se c'è una sola destinazione disponibile ci si va, altrimenti si apre l'elenco dei luoghi. È la stessa regola di "parla".

- **il complemento decide, non il verbo.** Se il complemento è un luogo o un passaggio, si cambia ambiente. Se è un oggetto o un personaggio dell'ambiente, non si cambia ambiente: la frase vale come uno degli altri tre verbi su quell'oggetto. "Sali sull'albero" e "entra nell'armadio" sono movimenti nel modo di dirlo e manipolazioni in quello che succede.

- si può tornare in un ambiente dell'atto già visitato, finché l'atto non lo chiude. Anche se lì è stato fatto tutto: aumenta la giocabilità e rende il costo di un errore dei passi invece che una partita.

- un luogo che il giocatore non conosce ancora non compare nell'elenco. **Si scopre dal testo**, mai da un elemento di interfaccia che si accende.

Hint: prevedere delle cutscene di passaggio fra alcuni ambienti migliora il ritmo. Vanno viste una volta sola, e sono direzionali: scendere in cantina e risalirne non sono la stessa sequenza.

### Dialoghi

I dialoghi possono essere statici e passivi, come un'osservazione di un dettaglio di scena, oppure possono portare a dei cambi di stato del gioco: sbloccare meccanismi, portare ad altri dialoghi, far proseguire la storia.

Hint:

- (per chi genera il file giocabile) Per aumentare la giocabilità, vanno preferiti dialoghi interattivi a grafo, con ramificazioni e riconvergenze, anziché sequenze lineari di battute. Il giocatore dovrebbe scegliere i percorsi della conversazione, che possono aprirsi, richiudersi e cambiare in base allo stato del gioco.

- generando più varianti per la stessa battuta aumenta l'immersività, soprattutto quando si ripete la medesima azione di dialogo.
