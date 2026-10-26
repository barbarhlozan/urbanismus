// Who runs a place: its slots, each filled by someone from a family living
// in town (src/sim/families.js), named on the building's card. Only the
// people a village would name – the innkeeper, the shop's manager, the
// headmistress, the priest – not every one of its jobs.
//
// ROLES: role -> who may hold it: 'm' men, 'f' women, 'a' either (as it
// was then: a priest, a stationmaster were men; a shop assistant, a nurse
// mostly women). What each is called: staff.<role> (and staff.<role>.f for
// a woman) in text/buildings.txt.
// STAFF: structure id -> its slots, in the order the card lists them.

export const ROLES = {
  hostinsky: 'm', servirka: 'f',
  vedouci: 'a', prodavacka: 'f',
  predseda_mnv: 'm',
  postmistr: 'a', listonos: 'a',
  recepcni: 'a',
  velitel_sboru: 'm', prislusnik_vb: 'm',
  lekar: 'a', sestra: 'f', primar: 'a',
  reditel_skoly: 'a', ucitel: 'f',
  vedouci_kd: 'a',
  farar: 'm', hrobnik: 'm',
  prednosta: 'm', vypravci: 'm',
  pumpar: 'm', pekar: 'm', kovar: 'm', truhlar: 'm', automechanik: 'm', sladek: 'm',
  reditel_zavodu: 'm',
  predseda_jzd: 'm', reditel_statku: 'm', agronom: 'a',
};

const WORKS = ['reditel_zavodu'];

export const STAFF = {
  hospoda: ['hostinsky'], 'hospoda-wide': ['hostinsky', 'servirka'],
  jednota: ['vedouci', 'prodavacka'], 'jednota-wide': ['vedouci', 'prodavacka', 'prodavacka'],
  store: ['vedouci', 'prodavacka'], 'store-wide': ['vedouci', 'prodavacka', 'prodavacka'],
  office: ['predseda_mnv'], 'office-wide': ['predseda_mnv'], 'office-tower': ['predseda_mnv'], 'office-tower-wide': ['predseda_mnv'],
  'post-office': ['postmistr', 'listonos'],
  hotel: ['recepcni'], 'hotel-wide': ['recepcni'],
  'fire-house': ['velitel_sboru'], 'fire-station': ['velitel_sboru'], 'fire-station-large': ['velitel_sboru'],
  police: ['prislusnik_vb'],
  'health-centre': ['lekar', 'sestra'], clinic: ['lekar', 'sestra'], hospital: ['primar', 'sestra'],
  school: ['reditel_skoly', 'ucitel', 'ucitel'],
  'culture-house': ['vedouci_kd'], 'culture-house-small': ['vedouci_kd'],
  church: ['farar'], cemetery: ['hrobnik'],
  station: ['prednosta', 'vypravci'], 'station-main': ['prednosta', 'vypravci'],
  benzina: ['pumpar'],
  pekarna: ['pekar'], 'pekarna-medium': ['pekar'],
  kovarna: ['kovar'], 'kovarna-medium': ['kovar'],
  truhlarna: ['truhlar'], 'truhlarna-medium': ['truhlar'],
  autoopravna: ['automechanik'], 'autoopravna-medium': ['automechanik'],
  pivovar: ['sladek'], 'pivovar-medium': ['sladek'],
  pila: WORKS, sklarna: WORKS, textilka: WORKS, 'textilka-medium': WORKS, strojirna: WORKS,
  panelarna: WORKS, vapenka: WORKS, elektrarna: WORKS, cukrovar: WORKS,
  mlekarna: WORKS, 'mlekarna-medium': WORKS,
  jzd: ['predseda_jzd', 'agronom'], 'state-farm': ['reditel_statku', 'agronom'],
};
