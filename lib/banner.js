/**
 * bgit Banner
 * Displays the CLI ASCII art
 */
module.exports = function showBanner() {
    console.log(`
\x1b[36m██╗\x1b[0m                 \x1b[35m██████╗\x1b[0m \x1b[33m██╗████████╗\x1b[0m
\x1b[36m██║\x1b[0m                \x1b[35m██╔════╝\x1b[0m \x1b[33m██║╚══██╔══╝\x1b[0m
\x1b[36m██████╗\x1b[0m            \x1b[35m██║  ███╗\x1b[0m \x1b[33m██║   ██║\x1b[0m
\x1b[36m██╔══██╗\x1b[0m           \x1b[35m██║   ██║\x1b[0m \x1b[33m██║   ██║\x1b[0m
\x1b[36m██████╔╝\x1b[0m \x1b[90m=======\x1b[0m   \x1b[35m╚██████╔╝\x1b[0m \x1b[33m██║   ██║\x1b[0m
\x1b[36m╚═════╝\x1b[0m            \x1b[35m╚═════╝\x1b[0m  \x1b[33m╚═╝   ╚═╝\x1b[0m

\x1b[90m> Bitcoin-Native Git Wrapper\x1b[0m
\x1b[90m> Pay-to-Operate • Universal History\x1b[0m
`);
};
