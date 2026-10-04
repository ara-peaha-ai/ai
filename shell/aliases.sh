# Shell aliases and functions, sourced from ~/.bashrc by install.sh.

# Search code, skipping dependency and build folders
alias rgcode='rg -g "!node_modules" -g "!.git" -g "!dist" -g "!build" -g "!venv" -g "!__pycache__" -g "!.next"'

# Force-kill apps that hang (desktop)
alias killproton='pkill -9 -f protonvpn'
alias killfolder='pkill -9 nautilus'
alias killnautilus='pkill -9 nautilus'

# Set a fixed terminal tab title: t <name>
t() { PS1="${PS1/\\\[\\e\]0;*\\a\\\]/}"; PROMPT_COMMAND="echo -ne '\033]0;$*\007'"; }

# Set a fixed terminal tab title and claude session: tc <name>
tc() { t "$*" && claude -n "$*"; }

# Set a fixed terminal tab title and grok session: tg <name>
tg() { t "$*" && grok; }
