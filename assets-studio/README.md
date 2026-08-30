# assets-studio

Gli strumenti che trasformano i **prompt** dell'IR in **asset** veri, e che
portano nella storia quelli approvati.

```
assets-studio/
  images/     immagini: estrazione del manifest, generazione, studio web,
              prototipazione dei modelli, pubblicazione
  .profile    la chiave API (non versionata)
  out/        uscite che non appartengono a nessuna storia — la sonda sui
              modelli, i confronti (non versionata, si rifà)
```

Una cartella per **tipo di asset**, non per fornitore: `images/` oggi, e
accanto ci staranno `voice/` e `sound/` quando esisteranno. Sono catene
diverse — un'immagine si giudica guardandola una alla volta, una voce si
giudica ascoltando una battuta nel suo contesto, e un ambiente sonoro si
giudica solo insieme all'immagine — quindi avranno manifest, studi e criteri
di approvazione propri.

Quello che invece **condividono** è il contratto ai due capi: leggono i prompt
da `stories/<id>/story.ir.json`, lavorano in `stories/<id>/_work/`, e
pubblicano in `stories/<id>/assets/` scrivendo nell'IR l'id di ciò che hanno
prodotto. L'IR non nomina mai un generatore: né un modello, né un fornitore,
né una voce: solo il prompt e, dopo la pubblicazione, il nome dell'asset.

Il modulo delle immagini è documentato in **[images/README.md](images/README.md)**;
le decisioni e il perché stanno in [ARCHITECTURE.md](../ARCHITECTURE.md).
