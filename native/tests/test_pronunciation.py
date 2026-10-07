import pytest

from server.speech import kokoro_phonemes, spoken_text


@pytest.mark.parametrize(
    "text,expected",
    [
        ("A Alexa? Rosie, você conhece a ALEXA?", "A Aléksa? Rôzi, você conhece a Aléksa?"),
        ("Alexa, Siri e Google.", "Aléksa, Siri e Google."),
        ("Alexandre e Rosiene", "Alexandre e Rosiene"),
        ("Trinta graus Celsius. CELSIUS!", "Trinta graus Célsius. Célsius!"),
        ("Celsiana e Célsius", "Celsiana e Célsius"),
        ("A LATAM e a Latam.", "A Latâm e a Latâm."),
        ("Não encontrei. ENCONTREI!", "Não encontrei. ENCONTREI!"),
        ("Reencontrei quem encontra.", "Reencontrei quem encontra."),
    ],
)
def test_spoken_names_preserve_punctuation_and_unrelated_words(text, expected):
    assert spoken_text(text) == expected


def test_portuguese_alexa_phonemes_use_ks_instead_of_sh():
    from misaki.espeak import EspeakG2P

    phonemes, _ = EspeakG2P(language="pt-br")(spoken_text("A Alexa é outra assistente."))
    assert "ks" in phonemes
    assert "ʃ" not in phonemes


def test_portuguese_celsius_stresses_the_first_syllable_in_the_active_voice_frontend():
    from misaki.espeak import EspeakG2P

    phonemes, _ = EspeakG2P(language="pt-br")(spoken_text("Trinta graus Celsius."))
    assert "sˈɛʊsjus" in phonemes
    assert "sɛʊsˈiʊs" not in phonemes


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Eu sou mais **divertida**!", "Eu sou mais divertida!"),
        ("A **Alexa** é __útil__, mas sou *divertida*.", "A Aléksa é útil, mas sou divertida."),
        ("Eu sou ***bem divertida***!", "Eu sou bem divertida!"),
        ("Diga `bom dia`.", "Diga bom dia."),
        ("2 * 3 e nome_do_arquivo", "2 * 3 e nome_do_arquivo"),
    ],
)
def test_speech_drops_emphasis_without_dropping_words_or_literal_symbols(text, expected):
    assert spoken_text(text) == expected


def test_latam_stresses_the_last_syllable_in_the_active_voice_frontend():
    from misaki.espeak import EspeakG2P

    phonemes, _ = EspeakG2P(language="pt-br")(spoken_text("A LATAM."))
    assert "latˈɐ̃m" in phonemes
    assert "lˈat" not in phonemes


@pytest.mark.parametrize(
    "word",
    [
        "encontrei",
        "identifiquei",
        "achei",
        "falei",
        "liguei",
        "desliguei",
        "sei",
        "deixei",
        "rei",
        "lei",
    ],
)
def test_stressed_ei_ending_uses_portuguese_vowels_in_the_active_voice_frontend(word):
    from misaki.espeak import EspeakG2P

    phonemes = kokoro_phonemes(f"{word}.", EspeakG2P(language="pt-br"))
    assert "ˈei." in phonemes
    assert "ˈA." not in phonemes


@pytest.mark.parametrize(
    "text",
    [
        "bem também alguém ninguém tem quem",
        "tempo sempre entendo tenho",
        "mãe sai noite pai",
        "primeiro feira direita",
        "Trinta graus Celsius. A Alexa e a LATAM.",
    ],
)
def test_ei_ending_correction_preserves_nasal_other_diphthongs_and_internal_syllables(text):
    from misaki.espeak import EspeakG2P

    g2p = EspeakG2P(language="pt-br")
    expected, _ = g2p(spoken_text(text))
    assert kokoro_phonemes(text, g2p) == expected


def test_ei_ending_correction_preserves_word_boundaries_and_punctuation():
    from misaki.espeak import EspeakG2P

    result = kokoro_phonemes('Identifiquei a luz. "Achei!" Sei?', EspeakG2P(language="pt-br"))
    assert "kˈei a" in result
    assert "ʃˈei!" in result
    assert "sˈei?" in result
