# Timeline visuelle — `1-0.ks`

Générée par `npm run trace:visual -- 1-0.ks --md <fichier>`. Aucun texte du jeu n'est reproduit : seuls les noms de commandes, d'assets et les états de rendu (positions, zoom, crop) figurent ici.

Colonnes : ligne source, commande, storage déclaré (clé normalisée), page visée, puis état visible.


## Page 0

| ligne | commande | storage | page | état visible après |
|---|---|---|---|---|
| 3 | `@bg` | `black` | back | prépare back : bg=black@centre \| calques: aucun |
| 5 | `@partbg` | `im02空(曇り)` | back | prépare back : bg=black@centre \| calques(1): pb1«im02空(曇り)» [partbg]@(748,288) z=1000<br>fore: «im02空(曇り)» rect déclaré x[542,1064] y[0,576] srczoom=(100,100)% bgstorage=black ; source visible x[542,1064] y[0,576] (image 1120×672)<br>back: «im02空(曇り)» rect déclaré x[542,1064] y[0,576] srczoom=(100,100)% bgstorage=black ; source visible x[542,1064] y[0,576] (image 1120×672) |

## Page 1

| ligne | commande | storage | page | état visible après |
|---|---|---|---|---|
| 15 | `@bg` | `white` | back | prépare back : bg=white@centre \| calques: aucun |
| 18 | `@clall` | — | back | prépare back : bg=white@centre \| calques: aucun |
| 19 | `@bg` | `im空絵a` | back | prépare back : bg=im空絵a@centre \| calques: aucun |
| 20 | `@fgact` | `im空絵b` | back | prépare back : bg=im空絵a@centre \| calques(1): im空絵b«im空絵b»@(512,288) z=1 op=0 |
| 21 | `@fgact` | `im空絵c` | back | prépare back : bg=im空絵a@centre \| calques(2): im空絵b«im空絵b»@(512,288) z=1 op=0 ; im空絵c«im空絵c»@(512,288) z=1100 op=0 |
| 22 | `@trans` | — | fore | affiche fore : bg=im空絵a@centre \| calques(2): im空絵b«im空絵b»@(512,288) z=1 op=0 ; im空絵c«im空絵c»@(512,288) z=1100 op=0 |
| 27 | `@bg` | `im森絵a` | back | prépare back : bg=im森絵a@centre \| calques: aucun |
| 28 | `@fgact` | `im森絵b` | back | prépare back : bg=im森絵a@centre \| calques(1): im森絵b«im森絵b»@(512,288) z=1 op=0 |
| 29 | `@fgact` | `im森絵c` | back | prépare back : bg=im森絵a@centre \| calques(2): im森絵b«im森絵b»@(512,288) z=1 op=0 ; im森絵c«im森絵c»@(512,288) z=1100 op=0 |
| 30 | `@trans` | — | fore | affiche fore : bg=im森絵a@centre \| calques(2): im森絵b«im森絵b»@(512,288) z=1 op=0 ; im森絵c«im森絵c»@(512,288) z=1100 op=0 |

## Page 2

| ligne | commande | storage | page | état visible après |
|---|---|---|---|---|
| 36 | `@bg` | `im木絵a` | back | prépare back : bg=im木絵a@centre \| calques: aucun |
| 37 | `@fgact` | `im木絵b` | back | prépare back : bg=im木絵a@centre \| calques(1): im木絵b«im木絵b»@(512,288) z=1 op=0 |
| 38 | `@fgact` | `im木絵c` | back | prépare back : bg=im木絵a@centre \| calques(2): im木絵b«im木絵b»@(512,288) z=1 op=0 ; im木絵c«im木絵c»@(512,288) z=1100 op=0 |
| 39 | `@trans` | — | fore | affiche fore : bg=im木絵a@centre \| calques(2): im木絵b«im木絵b»@(512,288) z=1 op=0 ; im木絵c«im木絵c»@(512,288) z=1100 op=0 |

## Page 3

| ligne | commande | storage | page | état visible après |
|---|---|---|---|---|
| 48 | `@bg` | `im家絵a` | back | prépare back : bg=im家絵a@centre \| calques: aucun |
| 49 | `@fgact` | `im家絵b` | back | prépare back : bg=im家絵a@centre \| calques(1): im家絵b«im家絵b»@(512,288) z=1 op=0 |
| 50 | `@fgact` | `im家絵c` | back | prépare back : bg=im家絵a@centre \| calques(2): im家絵b«im家絵b»@(512,288) z=1 op=0 ; im家絵c«im家絵c»@(512,288) z=1100 op=0 |
| 51 | `@trans` | — | fore | affiche fore : bg=im家絵a@centre \| calques(2): im家絵b«im家絵b»@(512,288) z=1 op=0 ; im家絵c«im家絵c»@(512,288) z=1100 op=0 |

## Page 6

| ligne | commande | storage | page | état visible après |
|---|---|---|---|---|
| 72 | `@clall` | — | back | prépare back : bg=im家絵a@centre \| calques: aucun |
| 73 | `@bg` | `im12猫の親子` | back | prépare back : bg=im12猫の親子@centre \| calques: aucun |
| 74 | `@fg` | `red` | back | prépare back : bg=im12猫の親子@centre \| calques(1): red«red»@(512,288) z=2000 op=0 |
| 75 | `@fg` | `white` | back | prépare back : bg=im12猫の親子@centre \| calques(2): red«red»@(512,288) z=2000 op=0 ; white«white»@(512,288) z=3000 op=0 |
| 76 | `@fgact` | `im12猫の親子b` | back | prépare back : bg=im12猫の親子@centre \| calques(3): im12猫の親子b«im12猫の親子b»@(512,288) z=1 op=0 ; red«red»@(512,288) z=2000 op=0 ; white«white»@(512,288) z=3000 op=0 |
| 77 | `@fgact` | `im12猫の親子c` | back | prépare back : bg=im12猫の親子@centre \| calques(4): im12猫の親子b«im12猫の親子b»@(512,288) z=1 op=0 ; im12猫の親子c«im12猫の親子c»@(512,288) z=1100 op=0 ; red«red»@(512,288) z=2000 op=0 ; white«white»@(512,288) z=3000 op=0 |
| 78 | `@trans` | — | fore | affiche fore : bg=im12猫の親子@centre \| calques(4): im12猫の親子b«im12猫の親子b»@(512,288) z=1 op=0 ; im12猫の親子c«im12猫の親子c»@(512,288) z=1100 op=0 ; red«red»@(512,288) z=2000 op=0 ; white«white»@(512,288) z=3000 op=0 |

## Page 9

| ligne | commande | storage | page | état visible après |
|---|---|---|---|---|
| 99 | `@movefg` | `red` | fore | prépare fore : bg=im12猫の親子@centre \| calques(4): im12猫の親子b«im12猫の親子b»@(512,288) z=1 op=0 ; im12猫の親子c«im12猫の親子c»@(512,288) z=1100 op=0 ; red«red»@(512,288) z=2000 op=0.314 ; white«white»@(512,288) z=3000 op=0 |

## Page 11

| ligne | commande | storage | page | état visible après |
|---|---|---|---|---|
| 114 | `@movefg` | `red` | fore | prépare fore : bg=im12猫の親子@centre \| calques(4): im12猫の親子b«im12猫の親子b»@(512,288) z=1 op=0 ; im12猫の親子c«im12猫の親子c»@(512,288) z=1100 op=0 ; red«red»@(512,288) z=2000 op=0.627 ; white«white»@(512,288) z=3000 op=0 |

## Page 12

| ligne | commande | storage | page | état visible après |
|---|---|---|---|---|
| 125 | `@movefg` | `red` | fore | prépare fore : bg=im12猫の親子@centre \| calques(4): im12猫の親子b«im12猫の親子b»@(512,288) z=1 op=0 ; im12猫の親子c«im12猫の親子c»@(512,288) z=1100 op=0 ; red«red»@(512,288) z=2000 op=0.157 ; white«white»@(512,288) z=3000 op=0 |
| 126 | `@movefg` | `white` | fore | prépare fore : bg=im12猫の親子@centre \| calques(4): im12猫の親子b«im12猫の親子b»@(512,288) z=1 op=0 ; im12猫の親子c«im12猫の親子c»@(512,288) z=1100 op=0 ; red«red»@(512,288) z=2000 op=0.157 ; white«white»@(512,288) z=3000 op=0.824 |

## Page 13

| ligne | commande | storage | page | état visible après |
|---|---|---|---|---|
| 134 | `@clall` | — | back | prépare back : bg=im12猫の親子@centre \| calques: aucun |
| 135 | `@bg` | `im木絵a` | back | prépare back : bg=im木絵a@centre \| calques: aucun |
| 136 | `@fgact` | `im木絵b` | back | prépare back : bg=im木絵a@centre \| calques(1): im木絵b«im木絵b»@(512,288) z=1 op=0 |
| 137 | `@fgact` | `im木絵c` | back | prépare back : bg=im木絵a@centre \| calques(2): im木絵b«im木絵b»@(512,288) z=1 op=0 ; im木絵c«im木絵c»@(512,288) z=1100 op=0 |
| 138 | `@trans` | — | fore | affiche fore : bg=im木絵a@centre \| calques(2): im木絵b«im木絵b»@(512,288) z=1 op=0 ; im木絵c«im木絵c»@(512,288) z=1100 op=0 |

## Page 15

| ligne | commande | storage | page | état visible après |
|---|---|---|---|---|
| 154 | `@bg` | `black` | back | prépare back : bg=black@centre \| calques: aucun |

## Page 16

| ligne | commande | storage | page | état visible après |
|---|---|---|---|---|
| 163 | `@bg` | `im洞窟絵a` | back | prépare back : bg=im洞窟絵a@centre \| calques: aucun |
| 164 | `@fgact` | `im洞窟絵b` | back | prépare back : bg=im洞窟絵a@centre \| calques(1): im洞窟絵b«im洞窟絵b»@(512,288) z=1 op=0 |
| 165 | `@fgact` | `im洞窟絵c` | back | prépare back : bg=im洞窟絵a@centre \| calques(2): im洞窟絵b«im洞窟絵b»@(512,288) z=1 op=0 ; im洞窟絵c«im洞窟絵c»@(512,288) z=1100 op=0 |
| 166 | `@trans` | — | fore | affiche fore : bg=im洞窟絵a@centre \| calques(2): im洞窟絵b«im洞窟絵b»@(512,288) z=1 op=0 ; im洞窟絵c«im洞窟絵c»@(512,288) z=1100 op=0 |

## Page 18

| ligne | commande | storage | page | état visible après |
|---|---|---|---|---|
| 179 | `@clall` | — | back | prépare back : bg=im洞窟絵a@centre \| calques: aucun |
| 180 | `@bg` | `white` | back | prépare back : bg=white@centre \| calques: aucun |
| 182 | `@clall` | — | back | prépare back : bg=white@centre \| calques: aucun |
| 183 | `@fg` | `red` | back | prépare back : bg=white@centre \| calques(1): red«red»@(512,288) z=6000 op=0 |
| 184 | `@fg` | `imルーン反応白光` | back | prépare back : bg=white@centre \| calques(2): imルーン反応白光«imルーン反応白光»@(512,288) z=3000 op=0 ; red«red»@(512,288) z=6000 op=0 |
| 185 | `@partbg` | `im0911根源光` | back | prépare back : bg=white@centre \| calques(3): pb1«im0911根源光» [partbg]@(512,288) z=2000 ; imルーン反応白光«imルーン反応白光»@(512,288) z=3000 op=0 ; red«red»@(512,288) z=6000 op=0<br>back: «im0911根源光» rect déclaré x[-188,836] y[38,614] srczoom=(400,400)% ; source visible x[196,452] y[253.25,397.25] (image 648×650) DÉCALAGE dx=384 dy=215.25 |
| 186 | `@fg` | `im12宇宙の果て01(中心無し)` | back | prépare back : bg=white@centre \| calques(4): im12宇宙の果て01(中心無し)«im12宇宙の果て01(中心無し)»@(512,288) z=1000 op=0 ; pb1«im0911根源光» [partbg]@(512,288) z=2000 ; imルーン反応白光«imルーン反応白光»@(512,288) z=3000 op=0 ; red«red»@(512,288) z=6000 op=0<br>back: «im0911根源光» rect déclaré x[-188,836] y[38,614] srczoom=(400,400)% ; source visible x[196,452] y[253.25,397.25] (image 648×650) DÉCALAGE dx=384 dy=215.25 |
| 187 | `@fgact` | `red` | back | prépare back : bg=white@centre \| calques(4): im12宇宙の果て01(中心無し)«im12宇宙の果て01(中心無し)»@(512,288) z=1000 op=0 ; pb1«im0911根源光» [partbg]@(512,288) z=2000 ; imルーン反応白光«imルーン反応白光»@(512,288) z=3000 op=0 ; red«red»@(512,288) z=6000<br>back: «im0911根源光» rect déclaré x[-188,836] y[38,614] srczoom=(400,400)% ; source visible x[196,452] y[253.25,397.25] (image 648×650) DÉCALAGE dx=384 dy=215.25 |
| 188 | `@fgact` | `imルーン反応白光` | back | prépare back : bg=white@centre \| calques(4): im12宇宙の果て01(中心無し)«im12宇宙の果て01(中心無し)»@(512,288) z=1000 op=0 ; pb1«im0911根源光» [partbg]@(512,288) z=2000 ; imルーン反応白光«imルーン反応白光»@(512,288) z=3000 op=0 ; red«red»@(512,288) z=6000<br>back: «im0911根源光» rect déclaré x[-188,836] y[38,614] srczoom=(400,400)% ; source visible x[196,452] y[253.25,397.25] (image 648×650) DÉCALAGE dx=384 dy=215.25 |
| 189 | `@partbgact` | `im0911根源光` | back | prépare back : bg=white@centre \| calques(4): im12宇宙の果て01(中心無し)«im12宇宙の果て01(中心無し)»@(512,288) z=1000 op=0 ; pb1«im0911根源光» [partbg]@(512,288) z=2000 ; imルーン反応白光«imルーン反応白光»@(512,288) z=3000 op=0 ; red«red»@(512,288) z=6000<br>back: «im0911根源光» rect déclaré x[-188,836] y[38,614] srczoom=(400,400)% ; source visible x[196,452] y[253.25,397.25] (image 648×650) DÉCALAGE dx=384 dy=215.25 |
| 190 | `@fgact` | `im12宇宙の果て01(中心無し)` | back | prépare back : bg=white@centre \| calques(4): im12宇宙の果て01(中心無し)«im12宇宙の果て01(中心無し)»@(512,288) z=1000 op=0 ; pb1«im0911根源光» [partbg]@(512,288) z=2000 ; imルーン反応白光«imルーン反応白光»@(512,288) z=3000 op=0 ; red«red»@(512,288) z=6000<br>back: «im0911根源光» rect déclaré x[-188,836] y[38,614] srczoom=(400,400)% ; source visible x[196,452] y[253.25,397.25] (image 648×650) DÉCALAGE dx=384 dy=215.25 |
| 193 | `@bg` | `black` | back | prépare back : bg=black@centre \| calques(4): im12宇宙の果て01(中心無し)«im12宇宙の果て01(中心無し)»@(512,288) z=1000 op=0 ; pb1«im0911根源光» [partbg]@(512,288) z=2000 ; imルーン反応白光«imルーン反応白光»@(512,288) z=3000 op=0 ; red«red»@(512,288) z=6000<br>fore: «im0911根源光» rect déclaré x[-188,836] y[38,614] srczoom=(400,400)% ; source visible x[196,452] y[253.25,397.25] (image 648×650) DÉCALAGE dx=384 dy=215.25<br>back: «im0911根源光» rect déclaré x[-188,836] y[38,614] srczoom=(400,400)% ; source visible x[196,452] y[253.25,397.25] (image 648×650) DÉCALAGE dx=384 dy=215.25 |
| 195 | `@clall` | — | back | prépare back : bg=black@centre \| calques: aucun<br>fore: «im0911根源光» rect déclaré x[-188,836] y[38,614] srczoom=(400,400)% ; source visible x[196,452] y[253.25,397.25] (image 648×650) DÉCALAGE dx=384 dy=215.25 |
| 198 | `@bg` | `im14祖父の洞窟` | back | prépare back : bg=im14祖父の洞窟@(-48,-48) \| calques: aucun |

## Page 19

| ligne | commande | storage | page | état visible après |
|---|---|---|---|---|
| 215 | `@bg` | `black` | back | prépare back : bg=black@centre \| calques: aucun |

## Page 20

| ligne | commande | storage | page | état visible après |
|---|---|---|---|---|
| 222 | `@bg` | `im14祖父の洞窟` | back | prépare back : bg=im14祖父の洞窟@centre \| calques: aucun |

## Page 22

| ligne | commande | storage | page | état visible après |
|---|---|---|---|---|
| 242 | `@bg` | `black` | back | prépare back : bg=black@centre \| calques: aucun |

## Page 24

| ligne | commande | storage | page | état visible après |
|---|---|---|---|---|
| 265 | `@bg` | `black` | back | prépare back : bg=black@centre \| calques: aucun |
