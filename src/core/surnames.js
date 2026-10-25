// Czech surnames and first names for the families of the town
// (src/sim/families.js). Each surname is written out in the three forms the
// game uses – a man's, a woman's and the family's (on a doorbell: Novákovi)
// – rather than made by rule, because the rules have their exceptions: a
// vowel that drops (Němec – Němcová – Němcovi, Marek – Marková), an ě that
// softens (Vaněk – Vaňková), adjectives that soften their last consonant in
// the plural (Tichý – Tichá – Tiší, Kopecký – Kopecká – Kopečtí) and soft
// adjectives that never change (Krejčí). Names common in Czechoslovakia
// from the 1950s to the 1980s. The key (the man's form without accents) is
// what the save keeps.

import { normalName } from '../story/script.js';

const LIST = [
  ['Novák', 'Nováková', 'Novákovi'],
  ['Svoboda', 'Svobodová', 'Svobodovi'],
  ['Novotný', 'Novotná', 'Novotní'],
  ['Dvořák', 'Dvořáková', 'Dvořákovi'],
  ['Černý', 'Černá', 'Černí'],
  ['Procházka', 'Procházková', 'Procházkovi'],
  ['Kučera', 'Kučerová', 'Kučerovi'],
  ['Veselý', 'Veselá', 'Veselí'],
  ['Horák', 'Horáková', 'Horákovi'],
  ['Němec', 'Němcová', 'Němcovi'],
  ['Marek', 'Marková', 'Markovi'],
  ['Pokorný', 'Pokorná', 'Pokorní'],
  ['Pospíšil', 'Pospíšilová', 'Pospíšilovi'],
  ['Hájek', 'Hájková', 'Hájkovi'],
  ['Král', 'Králová', 'Královi'],
  ['Jelínek', 'Jelínková', 'Jelínkovi'],
  ['Růžička', 'Růžičková', 'Růžičkovi'],
  ['Beneš', 'Benešová', 'Benešovi'],
  ['Fiala', 'Fialová', 'Fialovi'],
  ['Sedláček', 'Sedláčková', 'Sedláčkovi'],
  ['Doležal', 'Doležalová', 'Doležalovi'],
  ['Zeman', 'Zemanová', 'Zemanovi'],
  ['Kolář', 'Kolářová', 'Kolářovi'],
  ['Navrátil', 'Navrátilová', 'Navrátilovi'],
  ['Čermák', 'Čermáková', 'Čermákovi'],
  ['Vaněk', 'Vaňková', 'Vaňkovi'],
  ['Urban', 'Urbanová', 'Urbanovi'],
  ['Blažek', 'Blažková', 'Blažkovi'],
  ['Kříž', 'Křížová', 'Křížovi'],
  ['Kovář', 'Kovářová', 'Kovářovi'],
  ['Bartoš', 'Bartošová', 'Bartošovi'],
  ['Vlček', 'Vlčková', 'Vlčkovi'],
  ['Polák', 'Poláková', 'Polákovi'],
  ['Musil', 'Musilová', 'Musilovi'],
  ['Kopecký', 'Kopecká', 'Kopečtí'],
  ['Šimek', 'Šimková', 'Šimkovi'],
  ['Konečný', 'Konečná', 'Koneční'],
  ['Malý', 'Malá', 'Malí'],
  ['Holub', 'Holubová', 'Holubovi'],
  ['Štěpánek', 'Štěpánková', 'Štěpánkovi'],
  ['Kadlec', 'Kadlecová', 'Kadlecovi'],
  ['Dostál', 'Dostálová', 'Dostálovi'],
  ['Soukup', 'Soukupová', 'Soukupovi'],
  ['Šťastný', 'Šťastná', 'Šťastní'],
  ['Mareš', 'Marešová', 'Marešovi'],
  ['Moravec', 'Moravcová', 'Moravcovi'],
  ['Sýkora', 'Sýkorová', 'Sýkorovi'],
  ['Tichý', 'Tichá', 'Tiší'],
  ['Bureš', 'Burešová', 'Burešovi'],
  ['Kratochvíl', 'Kratochvílová', 'Kratochvílovi'],
  ['Vávra', 'Vávrová', 'Vávrovi'],
  ['Ševčík', 'Ševčíková', 'Ševčíkovi'],
  ['Hrubý', 'Hrubá', 'Hrubí'],
  ['Kašpar', 'Kašparová', 'Kašparovi'],
  ['Zelenka', 'Zelenková', 'Zelenkovi'],
  ['Krejčí', 'Krejčí', 'Krejčí'],
  ['Říha', 'Říhová', 'Říhovi'],
  ['Havlíček', 'Havlíčková', 'Havlíčkovi'],
  ['Hruška', 'Hrušková', 'Hruškovi'],
  ['Janda', 'Jandová', 'Jandovi'],
  ['Liška', 'Lišková', 'Liškovi'],
  ['Brož', 'Brožová', 'Brožovi'],
  ['Vondráček', 'Vondráčková', 'Vondráčkovi'],
  ['Skála', 'Skálová', 'Skálovi'],
];

// key -> { m, f, family }
export const SURNAMES = new Map(LIST.map(([m, f, family]) => [normalName(m), { m, f, family }]));

export const FIRST_NAMES = {
  m: ['Josef', 'Jan', 'Jiří', 'Jaroslav', 'Václav', 'František', 'Karel', 'Miroslav', 'Zdeněk', 'Ladislav',
    'Vladimír', 'Antonín', 'Stanislav', 'Milan', 'Oldřich', 'Bohumil', 'Jindřich', 'Vlastimil', 'Pavel', 'Petr'],
  f: ['Marie', 'Jana', 'Eva', 'Anna', 'Hana', 'Věra', 'Alena', 'Jaroslava', 'Ludmila', 'Zdeňka',
    'Jiřina', 'Božena', 'Libuše', 'Vlasta', 'Dagmar', 'Helena', 'Jarmila', 'Milada', 'Olga', 'Miroslava'],
};

// "Novákovi" for a family's key (the key itself if the list lost it).
export const familyName = (key) => SURNAMES.get(key)?.family ?? key;

// "Josef Novák" / "Marie Nováková".
export const personName = ({ first, sex, surname }) => `${first} ${SURNAMES.get(surname)?.[sex] ?? surname}`;
