"""Speaker handles made from a name: transliteration, formats, suffixes, validation."""
import pytest

from app.services.speaker_handle import (
    DEFAULT_FORMAT, HANDLE_FORMATS, MAX_LENGTH,
    base_handle, is_valid_handle, normalize_handle, transliterate, unique_handle,
)


def test_formats_and_default():
    assert HANDLE_FORMATS == ("first.last", "f.last", "first.l")
    assert DEFAULT_FORMAT == "first.last"


@pytest.mark.parametrize("text, expected", [
    ("Иван Петров", "ivan petrov"),
    ("Жанна Хохлова", "zhanna khokhlova"),
    ("Цой Чехов Шишкин Щукин", "tsoi chekhov shishkin shchukin"),
    ("Юлия", "yuliya"),
    ("Сергей", "sergei"),
    ("Подъём Мальцев", "podem maltsev"),
    ("Ёлкин Эрик Быков", "elkin erik bykov"),
    ("Їжак Єва Ґанок Іра", "izhak yeva ganok ira"),
    ("José Müller", "jose muller"),
    ("Straße Øster Łukasz", "strasse oster lukasz"),
])
def test_transliterate(text, expected):
    assert transliterate(text) == expected


@pytest.mark.parametrize("name, fmt, expected", [
    ("Иван Петров", "first.last", "ivan.petrov"),
    ("Иван Петров", "f.last", "i.petrov"),
    ("Иван Петров", "first.l", "ivan.p"),
    ("Olivia Brown", "first.last", "olivia.brown"),
    ("Mark", "first.last", "mark"),
    ("Mark", "f.last", "mark"),
    ("Mark", "first.l", "mark"),
    ("Anna Maria Lopez", "first.last", "anna.lopez"),
    ("  Anna   Lopez  ", "first.last", "anna.lopez"),
    ("Mary-Jane O'Neil", "first.last", "maryjane.oneil"),
    ("Agent 007", "first.last", "agent.007"),
    ("王小明", "first.last", "speaker"),
    ("王 Li", "first.last", "li"),
    ("!!!", "first.last", "speaker"),
])
def test_base_handle(name, fmt, expected):
    assert base_handle(name, fmt) == expected


def test_base_handle_is_cut_to_the_limit_without_a_trailing_separator():
    handle = base_handle("A" * 31 + " Brown", "first.last")
    assert len(handle) <= MAX_LENGTH
    assert handle == "a" * 31
    assert is_valid_handle(base_handle("Bartholomew Featherstonehaugh-Cholmondeley", "first.last"))


def test_base_handle_rejects_an_unknown_format():
    with pytest.raises(ValueError):
        base_handle("Ivan Petrov", "last.first")


def test_unique_handle_free_base_is_kept():
    assert unique_handle("ivan.ivanov", set()) == "ivan.ivanov"


def test_unique_handle_takes_the_smallest_free_number_from_two():
    assert unique_handle("ivan.ivanov", {"ivan.ivanov"}) == "ivan.ivanov2"
    assert unique_handle("ivan.ivanov", {"ivan.ivanov", "ivan.ivanov2"}) == "ivan.ivanov3"
    assert unique_handle("ivan.ivanov", {"ivan.ivanov", "ivan.ivanov3"}) == "ivan.ivanov2"


def test_unique_handle_ignores_case_of_taken():
    assert unique_handle("ivan.ivanov", {"Ivan.Ivanov"}) == "ivan.ivanov2"


def test_unique_handle_keeps_the_limit():
    base = "a" * MAX_LENGTH
    handle = unique_handle(base, {base})
    assert handle == "a" * (MAX_LENGTH - 1) + "2"
    assert len(handle) == MAX_LENGTH


def test_unique_handle_drops_a_separator_left_before_the_number():
    base = "a" * (MAX_LENGTH - 2) + ".b"
    assert unique_handle(base, {base}) == "a" * (MAX_LENGTH - 2) + "2"


@pytest.mark.parametrize("text, expected", [
    ("@Ivan.Petrov", "ivan.petrov"),
    ("  ivan  ", "ivan"),
    ("@@ivan", "ivan"),
    ("", ""),
])
def test_normalize_handle(text, expected):
    assert normalize_handle(text) == expected


@pytest.mark.parametrize("handle, ok", [
    ("ivan.petrov", True),
    ("i_p-2", True),
    ("7up", True),
    ("a", True),
    ("a" * MAX_LENGTH, True),
    ("a" * (MAX_LENGTH + 1), False),
    ("", False),
    (".ivan", False),
    ("-ivan", False),
    ("Ivan", False),
    ("ivan petrov", False),
    ("иван", False),
    ("ivan@x", False),
])
def test_is_valid_handle(handle, ok):
    assert is_valid_handle(handle) is ok
