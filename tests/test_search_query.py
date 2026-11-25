"""The search query language: words found by their beginning, AND by default,
AND / OR / NOT in capitals, parentheses, "exact phrases". Checked by what a
parsed query matches in a real FTS5 table, not by the expression it becomes."""

import sqlite3

import pytest

from app.services.search_query import SearchQueryError, parse_query

ROWS = [
    "Бюджет на год утвердили",           # 0
    "обсудили бюджета и сметы",          # 1
    "смета готова",                      # 2
    "уходим в отпуск, бюджет потом",     # 3
    "Ёлка в офисе",                      # 4
    "or else not now",                   # 5
    "ноябрь: бюджетный план",            # 6
    "из-за дождя перенесли",             # 7
    "C++ and the year's plan",           # 8
]


def _matches(query: str) -> set[int]:
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE VIRTUAL TABLE t USING fts5(text, tokenize='unicode61')")
    conn.executemany(
        "INSERT INTO t (rowid, text) VALUES (?, ?)",
        [(i, text.replace("ё", "е").replace("Ё", "Е")) for i, text in enumerate(ROWS)],
    )
    match = parse_query(query).match
    return {row[0] for row in conn.execute("SELECT rowid FROM t WHERE t MATCH ?", (match,))}


def test_a_word_is_found_by_its_beginning_whatever_the_case():
    assert _matches("бюджет") == {0, 1, 3, 6}
    assert _matches("БЮДЖЕТ") == {0, 1, 3, 6}


def test_yo_and_ye_are_one_letter():
    assert _matches("елка") == {4}
    assert _matches("ёлка") == {4}


def test_words_side_by_side_must_all_be_found():
    assert _matches("бюджет смет") == {1}
    assert _matches("бюджет AND смет") == {1}


def test_or_finds_either():
    assert _matches("смета OR отпуск") == {2, 3}


def test_not_leaves_out():
    assert _matches("бюджет NOT отпуск") == {0, 1, 6}


def test_parentheses_group():
    assert _matches("(смет OR отпуск) AND бюджет") == {1, 3}
    assert _matches("ноябрь (бюджет OR смета)") == {6}


def test_a_quoted_phrase_is_found_as_is():
    assert _matches('"бюджет на год"') == {0}
    assert _matches('"на год бюджет"') == set()


def test_lowercase_or_and_not_are_plain_words():
    assert _matches("or not") == {5}
    assert _matches("else or") == {5}


def test_signs_inside_a_word_are_not_query_syntax():
    assert _matches("из-за") == {7}
    assert _matches("C++") == {8}
    assert _matches("year's") == {8}
    assert _matches("план:") == {6}


def test_words_list_holds_the_words_looked_for_not_the_excluded_ones():
    parsed = parse_query('Маша (бюджет OR "смета на год") NOT отпуск')
    assert parsed.words == ["маша", "бюджет", "смета", "на", "год"]


@pytest.mark.parametrize("query", ["", "   ", "a", " я "])
def test_an_empty_or_one_letter_query_is_refused(query):
    with pytest.raises(SearchQueryError) as exc:
        parse_query(query)
    assert "two characters" in str(exc.value)


@pytest.mark.parametrize("query, hint", [
    ('"бюджет на', "quote"),
    ("(бюджет OR смета", "parenthes"),
    ("бюджет OR смета)", "parenthes"),
    ("()", "parenthes"),
    ("бюджет ()", "parenthes"),
    ("NOT отпуск", "NOT"),
    ("бюджет OR", "OR"),
    ("AND бюджет", "AND"),
    ("бюджет AND OR смета", "OR"),
    ("бюджет NOT", "NOT"),
    ("(NOT отпуск) бюджет", "NOT"),
    ('""', "quote"),
    ("-- !!", "word"),
])
def test_a_broken_query_is_refused_with_one_line_saying_what_to_fix(query, hint):
    with pytest.raises(SearchQueryError) as exc:
        parse_query(query)
    message = str(exc.value)
    assert "\n" not in message
    assert hint in message
    assert ":" in message, "what happened: what to do"


def test_every_refused_query_never_reaches_fts5_as_an_error():
    """Whatever passes the parser is a valid FTS5 expression."""
    for query in ["бюджет", "a b", "x OR (y z)", '"a b" NOT c', "(a) (b)", "'quoted'", "a*b", "^start", "col:on", "a+b"]:
        _matches(query)
