# Agent B — Questions et hypothèses

1. **Résolution des voix** : `AssetResolver` n'a pas de méthode `voice()`. Hypothèse : les voix (`voice`) sont résolues via `resolver.se()`. À trancher si un dossier `voice/` dédié est ajouté.
2. **Mode instant** : seuls les sons non bouclés des canaux `se:*` et `voice` sont ignorés. Un BGM non bouclé est joué normalement.
3. **Autoplay** : une lecture refusée par le navigateur est marquée « bloquée » et retentée par `unlock()` ou `resume()`. Un `waitFor` sur un son bloqué reste en attente jusqu'à la fin du son ou l'abort du signal.
4. **Backend** : `HTMLAudioElement` (pas de Web Audio API). Il est injectable via le 2ᵉ argument du constructeur de `WebAudioPlayer` (fonction `(url) => AudioElementLike`), pour les tests. Le contrat `AudioPlayerDeps` reste inchangé.
5. **stop avec fondu** : le canal est libéré tout de suite (un nouveau `play` peut démarrer pendant le fondu) et les `waitFor` sont réveillés immédiatement.
6. **Volume** : `master * volume du canal * volume de l'événement` ; `muted` force 0. Un `fade` modifie le volume de l'événement, pas les réglages.
