import { setFailed, warning } from "@actions/core";
import { GitHubPRAnalyzer } from "./analyzer";
import { context } from "@actions/github";

async function run(): Promise<void> {

  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const pr = context.payload.pull_request;
  const token = process.env.GITHUB_TOKEN;

  try {
    if(pr!=null && token!=null){
      const analyzer = new GitHubPRAnalyzer(token);
      const ishighSeveverityCommentIsNotResolved = await analyzer.analyzePRComments(owner, repo, pr.number);
      if(ishighSeveverityCommentIsNotResolved){
        setFailed("High severity comments aren't resolved");
      }
    }

  } catch (error) {
    console.error('Error in main:', error);
  }
}

process
  .on('unhandledRejection', (reason, p) => {
    warning(`Unhandled Rejection at Promise: ${reason}, promise is ${p}`)
  })
  .on('uncaughtException', (e: any) => {
    warning(`Uncaught Exception thrown: ${e}, backtrace: ${e.stack}`)
  })

await run()
