# Publish to GitHub

The repository is prepared for `arcadio-buendia/xpad-plus-plus`, with xpad++ as its
display name. Original Git history and the upstream MIT notice are retained.

1. Create an **empty** repository named `xpad-plus-plus` under `arcadio-buendia`:
   https://github.com/new . Do not initialize it with a README or license.
2. Test your existing GitHub SSH authentication:

   ```bash
   ssh -T git@github.com
   ```

   GitHub should greet `arcadio-buendia`; a successful authentication test exits
   with status 1 because GitHub does not provide shell access.
3. If you have no GitHub SSH key, generate one in your own terminal. Choose a new
   filename if the suggested file already exists; do not overwrite an existing key.

   ```bash
   ssh-keygen -t ed25519 -C "arcadio-buendia GitHub"
   eval "$(ssh-agent -s)"
   ssh-add ~/.ssh/id_ed25519
   cat ~/.ssh/id_ed25519.pub
   ```

   Add the **public** key to https://github.com/settings/ssh/new and test SSH again.
   Never share or upload the private key (`id_ed25519` without `.pub`).
4. Push the prepared local branch:

   ```bash
   cd /path/to/xpad-plus-plus
   git push -u origin HEAD:main
   ```

`upstream` points to faridjaff/StickyNotesCanvas; `origin` points to your new repo.
Future changes can be committed and pushed normally. The prepared commit uses
`arcadio-buendia <arcadio-buendia@users.noreply.github.com>` as its author; configure
your preferred Git identity locally for future commits if needed.
