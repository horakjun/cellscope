# CellScope for Pylontech

**[Otevřít aplikaci / Open the app → horakjun.github.io/cellscope](https://horakjun.github.io/cellscope/)**

Kontrola baterií **Pylontech US2000 / US3000 / US5000** přes konzolový kabel USB–RS232 – přehledně, po článcích, s pamětí BMS, historií zákazníků a protokolem do PDF.

## Česky

**Co umí**
- přečte všechny moduly: napětí, proud, SOC, SOH, cykly, teplotu článků i MOSFETů, balancování, stavy
- mapa všech článků s odchylkou od průměru modulu a verdikt *V pořádku / Sledovat / Problém*
- paměť BMS: celoživotní statistika ochran (`stat`), SOH článků (`soh`), deník událostí (`log`), uložené alarmy, historie (`data history`) s grafem rozptylu
- kontrola hodin baterie a přepočet časů událostí na skutečný čas
- zákazníci a měření uložená v PC, porovnání s minulou návštěvou, záloha do souboru
- protokol pro zákazníka (Uložit jako PDF / tisk) s vaším logem a údaji firmy
- 7 jazyků: čeština, angličtina, němčina, slovenština, polština, italština, holandština
- ukázková baterie pro vyzkoušení bez kabelu

**Co potřebujete**
- Windows 10/11 a prohlížeč **Microsoft Edge** nebo **Google Chrome** (Firefox sériový port neumí)
- konzolový kabel USB–RS232 do zdířky **Console** na master modulu (stejný jako pro BatteryView) s nainstalovaným ovladačem (Prolific PL2303, FTDI, CH340, CP210x)

**Instalace**
1. Otevřete [horakjun.github.io/cellscope](https://horakjun.github.io/cellscope/) v Edge nebo Chrome.
2. V adresním řádku klikněte na ikonu **Nainstalovat aplikaci**. CellScope se objeví v nabídce Start a funguje i bez internetu.

**Bezpečnost**
Aplikace posílá do baterie jen čtecí příkazy z pevného seznamu: `pwr`, `bat N`, `info N`, `time`, `stat N`, `soh N`, `log`, `data event`, `data history [N]`. Nic nemaže, nenastavuje ani nevypíná. Data zůstávají v prohlížeči na vašem PC.

## English

CellScope reads Pylontech US2000 / US3000 / US5000 batteries through the console port (USB–RS232 cable, the same one used by BatteryView) and shows every cell, the BMS memory (lifetime protection counters, cell SOH, event log, history), compares with the previous visit and produces a PDF report. Works in Microsoft Edge or Google Chrome on Windows and can be installed as an app (offline capable). Only read commands from a fixed whitelist are sent to the battery.

---
CellScope is not a Pylontech product. Pylontech is a trademark of its owner. MIT licence, no warranty – verify results against the manufacturer's documentation.
