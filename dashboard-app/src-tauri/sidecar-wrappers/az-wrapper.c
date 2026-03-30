/*
 * az-wrapper.c - Tauri sidecar wrapper for Azure CLI.
 *
 * Compiled binary is placed as  binaries/az-cli  (+ Tauri triple suffix).
 * At runtime it resolves the az-dist directory relative to its own location
 * and exec's  az-dist/bin/az  with all original args.
 *
 * Build:
 *   Linux   : gcc -O2 -o az-cli az-wrapper.c
 *   macOS   : clang -O2 -o az-cli az-wrapper.c
 *   Windows : cl /O2 /Fe:az-cli.exe az-wrapper.c
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#  include <windows.h>
#  include <process.h>
#  define PATH_SEP '\\'
#else
#  include <unistd.h>
#  include <libgen.h>
#  include <sys/stat.h>
#  include <limits.h>
#  define PATH_SEP '/'
#endif

#ifndef PATH_MAX
#  define PATH_MAX 4096
#endif

/* Candidate relative paths from the wrapper binary to az-dist */
static const char *CANDIDATES[] = {
    "/../binaries/az-dist",        /* dev layout: binaries/<wrapper> */
    "/../../binaries/az-dist",     /* Tauri bundled sidecar (Linux) */
    "/../Resources/binaries/az-dist", /* Tauri bundled (macOS .app)  */
    NULL,
};

static int dir_exists(const char *p) {
#ifdef _WIN32
    DWORD attr = GetFileAttributesA(p);
    return (attr != INVALID_FILE_ATTRIBUTES && (attr & FILE_ATTRIBUTE_DIRECTORY));
#else
    struct stat st;
    return stat(p, &st) == 0 && S_ISDIR(st.st_mode);
#endif
}

static int get_exe_dir(char *buf, size_t len) {
#ifdef _WIN32
    DWORD n = GetModuleFileNameA(NULL, buf, (DWORD)len);
    if (n == 0 || n >= len) return -1;
    char *sep = strrchr(buf, '\\');
    if (sep) *sep = '\0';
    return 0;
#elif defined(__APPLE__)
    uint32_t sz = (uint32_t)len;
    extern int _NSGetExecutablePath(char *, uint32_t *);
    char raw[PATH_MAX];
    if (_NSGetExecutablePath(raw, &sz) != 0) return -1;
    if (!realpath(raw, buf)) return -1;
    char *sep = strrchr(buf, '/');
    if (sep) *sep = '\0';
    return 0;
#else
    ssize_t n = readlink("/proc/self/exe", buf, len - 1);
    if (n <= 0) return -1;
    buf[n] = '\0';
    char *sep = strrchr(buf, '/');
    if (sep) *sep = '\0';
    return 0;
#endif
}

int main(int argc, char **argv) {
    char exe_dir[PATH_MAX];
    if (get_exe_dir(exe_dir, sizeof(exe_dir)) != 0) {
        fprintf(stderr, "az-cli: cannot resolve own path\n");
        return 1;
    }

    char dist_dir[PATH_MAX];
    char az_bin[PATH_MAX];
    const char **cand;

    for (cand = CANDIDATES; *cand; cand++) {
        snprintf(dist_dir, sizeof(dist_dir), "%s%s", exe_dir, *cand);
        if (dir_exists(dist_dir)) {
#ifdef _WIN32
            snprintf(az_bin, sizeof(az_bin), "%s\\bin\\az.cmd", dist_dir);
#else
            snprintf(az_bin, sizeof(az_bin), "%s/bin/az", dist_dir);
#endif
            /* Point Python to the bundled runtime so the shebang
               #!/usr/bin/env python3 resolves to az-dist/bin/python3 */
            char env_home[PATH_MAX];
            char env_path[PATH_MAX * 2];
            snprintf(env_home, sizeof(env_home), "PYTHONHOME=%s", dist_dir);
            putenv(env_home);
#ifdef _WIN32
            snprintf(env_path, sizeof(env_path), "PATH=%s\\bin;%s",
                     dist_dir, getenv("PATH") ? getenv("PATH") : "");
#else
            snprintf(env_path, sizeof(env_path), "PATH=%s/bin:%s",
                     dist_dir, getenv("PATH") ? getenv("PATH") : "");
#endif
            putenv(env_path);

            argv[0] = az_bin;
#ifdef _WIN32
            return _spawnv(_P_WAIT, az_bin, (const char *const *)argv);
#else
            execv(az_bin, argv);
            perror("az-cli: execv");
            return 1;
#endif
        }
    }

    fprintf(stderr, "az-cli: az-dist not found near %s\n", exe_dir);
    return 1;
}
