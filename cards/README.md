# Lemma — Cards

The curated card corpus. Each card is a structured record of a
principle (physics, chemistry, biology, climate, mathematics,
engineering), an operations protocol (job templates, workflow recipes),
or a proposed hypothesis awaiting verification. The schema is universal
across domains — what differs is the `domain` field, not the shape.

The wire format lives one level up at `../schema/card.v0.1.json`.

## Layout

```
cards/
├── physics/
│   ├── condensed-matter/           Lindhard, DOS, JDOS, Bloch, LDA xc
│   ├── classical-mechanics/        free fall, simple harmonic oscillator, momentum
│   ├── thermodynamics/             1st law, Boltzmann entropy / 2nd law
│   ├── statistical-mechanics/      Maxwell-Boltzmann speed distribution
│   ├── electromagnetism/           Gauss, Faraday, Coulomb
│   └── fluid-dynamics/             continuity equation
├── engineering/
│   ├── fluid-dynamics/             Reynolds number similarity
│   └── solid-mechanics/            Hooke's law (linear elasticity)
├── chemistry/
│   ├── thermodynamics/             ideal gas
│   ├── stoichiometry/              mass / atom balance
│   ├── kinetics/                   Arrhenius
│   ├── electrochemistry/           Nernst
│   └── acid-base/                  Henderson-Hasselbalch
├── biology/
│   ├── enzyme-kinetics/            Michaelis-Menten
│   ├── population-genetics/        Hardy-Weinberg
│   └── population-dynamics/        Lotka-Volterra
├── climate/
│   ├── radiative/                  Stefan-Boltzmann
│   └── radiative-forcing/          CO2 logarithmic forcing
├── mathematics/
│   └── analysis/                   Cauchy-Schwarz, mean-value theorem, triangle inequality
├── numerical-methods/
│   ├── ode/                        Runge-Kutta 4
│   └── pde/                        CFL stability, finite-difference truncation
├── ops/                            SLURM (MN5), Snakemake DFT workflow, Singularity recipe
└── hypotheses/
    ├── free-fall-with-linear-drag.json
    └── lotka-volterra-with-logistic-prey.json
```

**33 PrincipleCards** + **3 OpsCards** + **2 HypothesisCards** = 38
records across 20 sub-domains and 8 root domains. New domains (geology,
etc.) drop in without schema changes.

## Variants

A card is one of four discriminated variants on `kind`:

- **`principle`** — curated, peer-recognisable scientific principle.
  Carries a canonical formula, conventions, expected asymptotic limits,
  references, and optional numerical validation envelopes.
- **`ops`** — parameterised template for a scripting / job-submission
  task. Carries parameter definitions and validation rules instead of
  a formula.
- **`hypothesis`** — proposed extension to the corpus, explicitly marked
  unverified; declares the cross-checks the engine must run before the
  card can be promoted.
- **`unidentified`** — sentinel returned by the IDENTIFY phase of a
  pipeline when no card honestly matches the request. Surfaced verbatim
  to the user instead of fabricating a fallback.

## Validation

Validate any card against the schema with `ajv`:

```sh
npx ajv-cli validate \
  -s ../schema/card.v0.1.json \
  -d "**/*.json"
```

Each PR adding or modifying a card runs schema validation, KaTeX render
check on `formulaTeX` / `proposedFormulaTeX`, reference resolution
(DOIs / URLs return HTTP 200), and id-uniqueness check. Hypothesis cards
additionally run through the cross-check engine against the current
corpus.

## Versioning

Cards are versioned independently in semver:

- **MAJOR** — breaking convention change (sign-flip, removed required field)
- **MINOR** — additive change (new `expectedLimits` entry, new `validationEnvelopes` key)
- **PATCH** — typo / reference fix

The schema document (`../schema/card.v0.1.json`) is versioned as a
whole; bumping it is a breaking change for the ecosystem.

## Licensing

CC-BY 4.0. Attribution required when reusing.
