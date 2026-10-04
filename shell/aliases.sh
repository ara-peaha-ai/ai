# Shell aliases and functions, sourced from ~/.bashrc by install.sh.

# Search code, skipping dependency and build folders
alias rgcode='rg -g "!node_modules" -g "!.git" -g "!dist" -g "!build" -g "!venv" -g "!__pycache__" -g "!.next"'

# Force-kill apps that hang (desktop)
alias killproton='pkill -9 -f protonvpn'
alias killfolder='pkill -9 nautilus'
alias killnautilus='pkill -9 nautilus'

# Set a fixed terminal tab title: t <name>
t() { PS1="${PS1/\\\[\\e\]0;*\\a\\\]/}"; __tab_title="$*"; PROMPT_COMMAND='printf "\033]0;%s\007" "$__tab_title"'; }

# Set a fixed terminal tab title and claude session: tc <name>
tc() { t "$*" && claude -n "$*"; }

# Set a fixed terminal tab title and grok session: tg <name>
tg() { t "$*" && grok; }
