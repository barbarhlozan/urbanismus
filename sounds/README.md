# The game's recordings

Every sound in the game is one of these recordings, all from Freesound. Two are CC BY 4.0 and
must be credited (author, title, licence, a link): the game lists them all in the Menu's
Credits (`src/audio/sounds.js`, which also says which file is which). The CC0 ones need no
credit and get it all the same.

| file | what | from |
| --- | --- | --- |
| `birds-olomouc.mp3` | one songbird (a chaffinch, by its song) singing phrase after phrase, in Olomouc | [SoundEnsemble, Freesound 550850](https://freesound.org/s/550850/), recorded by Piotrek Zyla, CC0 |
| `forest-june.mp3` | a Czech forest in June, many birds further off | [Kukensius, Freesound 347618](https://freesound.org/s/347618/), CC0 |
| `rain-woods.mp3` | spring rain in the woods of northern Bohemia: the wind rising in the trees (to 28 s), then the rain (from 33 s) | [Berwitz, Freesound 150195](https://freesound.org/s/150195/), **CC BY 4.0** |
| `pencil.mp3` | thirteen pencil scribbles on a notebook, the pencil when something is built | [Xalkomak, Freesound 697239](https://freesound.org/s/697239/), CC0 |
| `wood.mp3` | six light taps of wood, the buttons | [Ranner, Freesound 487587](https://freesound.org/s/487587/), CC0 |
| `knock.mp3` | a battery's end knocked on a wooden panel, the bigger buttons | [F.M.Audio, Freesound 560334](https://freesound.org/s/560334/), **CC BY 4.0** |

How the game plays them: the birds `src/audio/birds.js`, the rain and the wind in the trees
`src/audio/bed.js` (the parts of `rain-woods.mp3` are in `SOUND` in `ambience.js`), the pencil
and the taps `src/audio/effects.js`. The song is cut into phrases by hand (`PHRASES` in
birds.js, seconds in the file), so a new cut of `birds-olomouc.mp3` needs new phrase times; the
pencil, the wood and the knock are cut where they fall silent as they are read, so any file of
separate sounds with silence between them can take their place.

## How they were made from the originals

The Olomouc recording: to one channel, the city's low rumble cut away (the birds are all above
it), a little noise reduction, 6.7 dB louder:

```
ffmpeg -i olomouc.wav -ac 1 -ar 48000 -af "highpass=f=900:poles=2,highpass=f=900:poles=2,afftdn=nr=10:nf=-60:tn=1" -c:a pcm_f32le clean.wav
ffmpeg -i clean.wav -af volume=6.7dB -ar 44100 -c:a libmp3lame -q:a 4 birds-olomouc.mp3
```

The forest: its hiss and rumble taken out by a noise profile sampled from a quiet stretch
(26–30 s, put in front of the recording for that and cut off after), 8.1 dB louder:

```
printf '0.3 afftdn sample_noise start;\n3.7 afftdn sample_noise stop;\n' > cmds.txt
ffmpeg -ss 26 -t 4 -i forest.wav -i forest.wav -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1,aresample=48000,highpass=f=250:poles=2,highpass=f=250:poles=2,asendcmd=f=cmds.txt,afftdn=nr=16:nf=-50:tr=1,lowpass=f=12000,atrim=start=4,asetpts=PTS-STARTPTS" -c:a pcm_f32le clean.wav
ffmpeg -i clean.wav -af volume=8.1dB -ar 44100 -c:a libmp3lame -q:a 5 forest-june.mp3
```

The rain in the woods: a little under its peaks, the lowest rumble cut:

```
ffmpeg -i rain.wav -af "highpass=f=40:poles=2,volume=-1.5dB" -ar 44100 -c:a libmp3lame -q:a 5 rain-woods.mp3
```

The short ones, to one channel (the pencil's and the wood's desk thumps cut, the wood 8.7 dB
louder):

```
ffmpeg -i pencil.wav -ac 1 -af "highpass=f=120:poles=2,volume=-0.4dB" -ar 44100 -c:a libmp3lame -q:a 4 pencil.mp3
ffmpeg -i wood.wav -ac 1 -af "highpass=f=80:poles=2,volume=8.7dB" -ar 44100 -c:a libmp3lame -q:a 4 wood.mp3
ffmpeg -i panel.wav -ac 1 -af "volume=-0.4dB" -ar 44100 -c:a libmp3lame -q:a 4 knock.mp3
```

MP3, because every browser can read it.
