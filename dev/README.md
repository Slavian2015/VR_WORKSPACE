# Development stand

Tools for trying changes without touching the desktop you are working on. They are not part of the product.

- `iso.sh` — starts a second, invisible GNOME Shell with its own settings and runs a list of actions in it
  (clicks, keys, screenshots, JavaScript inside the shell). The project's extension is loaded there and asks port
  18080 instead of 8080. Read its header for the options.
- `drive.py` — carries out the actions; the list of them is in its header.

```bash
printf 'eval:Main.overview.hide()\nprefs\nwait:4\nshot:settings\n' > /tmp/actions.txt
dev/iso.sh /tmp/actions.txt        # screenshots and logs land in the folder it prints
```

Rules learnt the hard way:
- `iso.sh` watches the PC's memory and kills the test when it grows (`GROWTH`, 800 MB by default). Do not remove
  that and do not run screen-recording experiments outside it: GNOME 46 can leak graphics memory fast enough to
  freeze the PC within a minute, and it did, twice;
- never listen on port 8080 in a test: the extension of the real desktop asks that port;
- stop test processes by exact name or by port, never by a pattern that is also in the command being run;
- tests must not change the default sound output of the real desktop;
- that shell has no X11: GNOME starts Xwayland only through systemd, which the test session lacks. X11 programs
  (Flatpak VLC among them) cannot be tried there;
- the guard counts the memory of the whole PC: programs the user works with meanwhile (a browser, FreeCAD) can
  stop a test too. Then run it again, and if in doubt look at what grew.
