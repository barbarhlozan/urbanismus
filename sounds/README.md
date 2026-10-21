# The game's recordings

The wind and the rain are made in code (`src/audio/ambience.js`); these are the recordings, both
from the Czech countryside, both CC0 (free to use, no credit needed – given here all the same).

| file | what | from |
| --- | --- | --- |
| `birds-olomouc.mp3` | one songbird (a chaffinch, by its song) singing phrase after phrase, in Olomouc | [SoundEnsemble, Freesound 550850](https://freesound.org/s/550850/), recorded by Piotrek Zyla, CC0 |
| `forest-june.mp3` | a Czech forest in June, many birds further off | [Kukensius, Freesound 347618](https://freesound.org/s/347618/), CC0 |

How the game plays them: `src/audio/birds.js`. The song is cut into phrases there (`PHRASES`,
seconds in the file); a new cut of `birds-olomouc.mp3` needs new phrase times.

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

MP3, because every browser can read it.
