const core = require("@actions/core");
const github = require("@actions/github");
const fs = require("fs");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;

async function run() {
    try {
        const token = process.env.GITHUB_TOKEN;
        if (!token) throw new Error("GITHUB_TOKEN not found");

        const octokit = github.getOctokit(token);
        const {owner, repo} = github.context.repo;

        // 7 days ago
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        // Fetch closed PRs (first 100)
        const {data: prs} = await octokit.rest.pulls.list({
            owner,
            repo,
            state: "closed",
            sort: "updated",
            direction: "desc",
            per_page: 100,
        });

        // Filter merged in last 7 days
        const mergedPRs = prs.filter(
            (pr) => pr.merged_at && new Date(pr.merged_at) >= sevenDaysAgo,
        );

        if (mergedPRs.length === 0) {
            console.log("No merged PRs in the last 7 days");
        }

        // Aggregate time per author
        const summary = {};

        mergedPRs.forEach((pr) => {
            const author = pr.user.login;
            const body = pr.body || "";

            // Extract time from {H:MM} format using regex
            const match = body.match(/\{(\d+):(\d{2})\}/);
            if (match) {
                const hours = parseInt(match[1], 10);
                const minutes = parseInt(match[2], 10);
                const timeInHours = hours + minutes / 60;

                if (!summary[author]) {
                    summary[author] = {hoursDecimal: 0, hours: 0, minutes: 0};
                }

                summary[author].hoursDecimal += timeInHours;
                summary[author].hours += hours;
                summary[author].minutes += minutes;
            } else {
                console.warn(`No time found in PR #${pr.number} by ${author}`);
            }
        });

        // Normalize minutes > 60
        for (const author in summary) {
            const totalMinutes = summary[author].minutes;
            summary[author].hours += Math.floor(totalMinutes / 60);
            summary[author].minutes = totalMinutes % 60;
        }

        // Prepare CSV
        const csvWriter = createCsvWriter({
            path: "timesheet.csv",
            header: [
                {id: "author", title: "Author"},
                {id: "hoursDecimal", title: "Hours"},
                {id: "hoursHuman", title: "Time"},
            ],
        });

        const records = Object.keys(summary).map((author) => ({
            author,
            hoursDecimal: summary[author].hoursDecimal.toFixed(2),
            hoursHuman: `${summary[author].hours}h${summary[author].minutes}min`,
        }));

        await csvWriter.writeRecords(records);

        // Prepare JSON
        fs.writeFileSync("timesheet.json", JSON.stringify(summary, null, 2));

        console.log("Timesheet generated: timesheet.csv & timesheet.json");
        core.setOutput("timesheet_file", "timesheet.csv");
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();
