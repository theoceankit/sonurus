"""The search query language, turned into an SQLite FTS5 expression.

Words side by side must all be found; AND, OR and NOT in capitals are operators
(in lowercase they are words); parentheses group; "a phrase" is found as is.
A word is found by its beginning: "budget" finds "budgets". Every error is one
line saying what is wrong and what to do.
"""

from dataclasses import dataclass

from app.db.search_index import normalize

OPERATORS = ("AND", "OR", "NOT")


class SearchQueryError(ValueError):
    """A query that cannot be searched; the message is one line for the user."""


@dataclass
class ParsedQuery:
    match: str          # the FTS5 expression
    words: list[str]    # the words looked for, normalized, in order; not the excluded ones


@dataclass
class _Token:
    kind: str           # "word", "phrase", "AND", "OR", "NOT", "(", ")"
    text: str = ""


def parse_query(query: str) -> ParsedQuery:
    if len(query.strip()) < 2:
        raise SearchQueryError("The search query is too short: type at least two characters.")
    tokens = _with_implicit_and(_tokens(query))
    if not tokens:
        raise SearchQueryError("Nothing to search for in the query: type at least one word.")
    _check(tokens)
    return ParsedQuery(match=" ".join(_fts(t) for t in tokens), words=_positive_words(tokens))


def _tokens(query: str) -> list[_Token]:
    tokens: list[_Token] = []
    i, n = 0, len(query)
    while i < n:
        ch = query[i]
        if ch.isspace():
            i += 1
        elif ch in "()":
            tokens.append(_Token(ch))
            i += 1
        elif ch == '"':
            end = query.find('"', i + 1)
            if end == -1:
                raise SearchQueryError('Unclosed quote in the search query: add the closing ".')
            phrase = query[i + 1:end]
            if not _has_letters(phrase):
                raise SearchQueryError("Empty quotes in the search query: put words between the quotes or remove them.")
            tokens.append(_Token("phrase", phrase))
            i = end + 1
        else:
            start = i
            while i < n and not query[i].isspace() and query[i] not in '()"':
                i += 1
            word = query[start:i]
            if word in OPERATORS:
                tokens.append(_Token(word))
            elif _has_letters(word):
                tokens.append(_Token("word", word))
            # a word of signs only ("--", "!") has nothing to find and is left out
    return tokens


def _has_letters(text: str) -> bool:
    return any(ch.isalnum() for ch in text)


def _with_implicit_and(tokens: list[_Token]) -> list[_Token]:
    """An operand or a group right after another one is joined to it by AND."""
    out: list[_Token] = []
    for token in tokens:
        if out and out[-1].kind in ("word", "phrase", ")") and token.kind in ("word", "phrase", "("):
            out.append(_Token("AND"))
        out.append(token)
    return out


def _check(tokens: list[_Token]) -> None:
    """expr := term (op term)*;  term := operand | "(" expr ")"."""
    depth = 0
    expect_term = True
    for i, token in enumerate(tokens):
        if expect_term:
            if token.kind in ("word", "phrase"):
                expect_term = False
            elif token.kind == "(":
                depth += 1
            elif token.kind == ")":
                if depth == 0:
                    raise _unbalanced()
                raise SearchQueryError("Empty parentheses in the search query: put words inside or remove them.")
            else:
                raise _operator_alone(token.kind)
        else:
            if token.kind == ")":
                if depth == 0:
                    raise _unbalanced()
                depth -= 1
            elif token.kind in OPERATORS:
                expect_term = True
            else:  # cannot happen after _with_implicit_and
                raise _unbalanced()
    if expect_term:
        last = tokens[-1].kind
        if last in OPERATORS:
            raise _operator_alone(last)
        raise SearchQueryError("Empty parentheses in the search query: put words inside or remove them.")
    if depth:
        raise _unbalanced()


def _unbalanced() -> SearchQueryError:
    return SearchQueryError("Unbalanced parentheses in the search query: close every ( with ).")


def _operator_alone(op: str) -> SearchQueryError:
    if op == "NOT":
        return SearchQueryError(
            'NOT needs words on both sides in the search query: write "budget NOT holiday", not "NOT holiday".'
        )
    return SearchQueryError(f'{op} needs words on both sides in the search query: write "budget {op} plan".')


def _fts(token: _Token) -> str:
    if token.kind == "word":
        return _quoted(token.text) + "*"
    if token.kind == "phrase":
        return _quoted(token.text)
    return token.kind


def _quoted(text: str) -> str:
    """A string FTS5 tokenizes itself, so no character of it is query syntax."""
    return '"' + normalize(text).replace('"', '""') + '"'


def _positive_words(tokens: list[_Token]) -> list[str]:
    """Words of the operands not excluded by NOT; a group after NOT is excluded whole."""
    words: list[str] = []
    depth = 0
    skipped_group: int | None = None    # depth of a group excluded by NOT
    after_not = False
    for token in tokens:
        if token.kind == "NOT":
            after_not = True
        elif token.kind == "(":
            depth += 1
            if after_not and skipped_group is None:
                skipped_group = depth
            after_not = False
        elif token.kind == ")":
            if skipped_group == depth:
                skipped_group = None
            depth -= 1
        elif token.kind in ("word", "phrase"):
            if not after_not and skipped_group is None:
                words += [w for w in normalize(token.text).lower().split() if _has_letters(w)]
            after_not = False
    return words
