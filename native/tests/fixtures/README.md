# Speech detector fixture

`local-greeting.wav` is the project's synthetic Kokoro pf_dora preview:
“Bom dia! Eu sou a Rosie. Você quer conversar comigo?” (with the existing
spoken-name pronunciation override). Mono, 16 kHz, signed 16-bit PCM.
It contains no microphone recording or user conversation. It exercises speech
acceptance with the actual local detector, reduced amplitude and the device codec.
