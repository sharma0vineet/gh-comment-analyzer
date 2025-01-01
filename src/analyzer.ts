// Types
// @ts-ignore
import { info } from "@actions/core";

interface PRReview {
  id: number;
  user: {
    login: string;
  };
  state: string;
}

export class GitHubPRAnalyzer {
  private baseUrl: string = 'https://api.github.com';
  private token: string | undefined;

  constructor(token: string | undefined) {
    this.token = token;
  }

  // Helper method for making GraphQL calls
  private async makeGraphQLCall<T>(query: string, variables: any): Promise<T> {
    const response = await fetch(`${this.baseUrl}/graphql`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });


    if (!response.ok) {
      throw new Error(`GitHub GraphQL API call failed: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.errors) {
      throw new Error(`GraphQL Error: ${JSON.stringify(data.errors)}`);
    }

    return data;
  }

  // Fetch comment status (outdated/resolved) using GraphQL
  async fetchAllThreadsWithStatus(
    owner: string,
    repo: string,
    pullNumber: number
  ) {
    const query = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
            pullRequest(number: $number) {
                reviewThreads(first: 100) {
                    nodes {
                        isResolved
                        isOutdated
                        resolvedBy {
                            login
                        }
                        id
                        comments(first: 100) {
                            nodes {
                                id
                                body
                                author {
                                    login
                                }
                                createdAt
                                path
                                line
                                outdated
                                position
                                url
                            }
                        }
                    }
                }
            }
        }
    }`;

    const response = await this.makeGraphQLCall<any>(query, {
      owner,
      repo,
      number: pullNumber
    });
    const allThreads=response.data.repository.pullRequest.reviewThreads.nodes
    //
    const threadsStartedByRazorGenius=allThreads.filter((thread: {comments: any}) => {
      if(thread.comments.nodes.length > 0){
        const firstComment=thread.comments.nodes[0];
        if(this.isRazorGeniusComment(firstComment.body)){
          const severity= this.getSeverity(firstComment.body);
          if(severity==null){
            return false;
          }
          return severity=='high';
        }
      }
      return false;
    })
    threadsStartedByRazorGenius.forEach((thread: { comments: { nodes: any[]; }; resolvedBy: { login: any; }; isResolved: boolean }) =>
      thread.comments.nodes.filter(comment => comment.body.length > 0).map(comment => ({
        id: comment.id,
        body: comment.body,
        author: comment.author.login,
        createdAt: comment.createdAt,
        path: comment.path,
        line: comment.line,
        position: comment.position,
        resolvedBy: thread.resolvedBy?.login,
        url: comment.url,
      })
      ))

    // Resolved And OutDated Threads.
    // Conversation is marked resolved and comments are also outdated, means code is changed. Now the RazorGenius will generate new comments.
    const resolvedAndOutdatedThreads = threadsStartedByRazorGenius.filter((thread: { isResolved: any; isOutdated:any}) => thread.isResolved && thread.isOutdated)
    resolvedAndOutdatedThreads.forEach(
      (thread: { comments: { nodes: { status: string }[] } }) => {
        thread.comments.nodes.forEach((comment: { status: string }) => {
          comment.status = "resolvedAndOutdated";
        });
      }
    );

    // Resolved converstation But the code is not updated. It means user has simply resolved the converstations.
    const resolvedAndNotOutdatedThreads = threadsStartedByRazorGenius.filter((thread: { isResolved: any; isOutdated:any}) => thread.isResolved && !thread.isOutdated)
    resolvedAndNotOutdatedThreads.forEach(
      (thread: { comments: { nodes: { status: string }[] } }) => {
        thread.comments.nodes.forEach((comment: { status: string }) => {
          comment.status = "resolvedAndNotOutdated";
        });
      }
    );



    // The conversation is not marked resolved but the code is comment is outdated, i.e the code has been updated.
    // In such case the OpenAI will generate new comments for the diff
    const unresolvedAndOutdatedThreads = threadsStartedByRazorGenius.filter((thread: { isResolved: any; isOutdated:any}) => !thread.isResolved && thread.isOutdated)
    unresolvedAndOutdatedThreads.forEach(
      (thread: { comments: { nodes: { status: string }[] } }) => {
        thread.comments.nodes.forEach((comment: { status: string }) => {
          comment.status = "unresolvedAndOutdated";
        });
      }
    );


    // UnResolved and Not outdated comments. Means neither the code is updated nor the comment is resolved.
    const unresolvedAndNotOutdatedThreads = threadsStartedByRazorGenius.filter((thread: { isResolved: any; isOutdated:any}) => !thread.isResolved && !thread.isOutdated)
    unresolvedAndNotOutdatedThreads.forEach(
      (thread: { comments: { nodes: { status: string }[] } }) => {
        thread.comments.nodes.forEach((comment: { status: string }) => {
          comment.status = "unresolvedAndNotOutdated";
        });
      }
    );



    return {
      resolvedAndOutdatedThreads: resolvedAndOutdatedThreads,
      resolvedAndNotOutdatedThreads: resolvedAndNotOutdatedThreads,
      unresolvedAndOutdatedThreads: unresolvedAndOutdatedThreads,
      unresolvedAndNotOutdatedThread: unresolvedAndNotOutdatedThreads
    };
  }

  // Check if comment is from RazorGenius
  private isRazorGeniusComment(commentBody: string): boolean {
    return commentBody.includes('This is an auto-generated comment by OSS CodeRabbit');
  }

  // Parse severity from comment body
  private getSeverity(commentBody: string): string | null {
    const severityMatch = commentBody.match(/\[severity:(high|low)\]/i);
    return severityMatch ? severityMatch[1].toLowerCase() : null;
  }

  // Main analysis function
  async analyzePRComments(
    owner: string,
    repo: string,
    prNumber: number) {
    try {

      const threadMaps = (await this.fetchAllThreadsWithStatus(owner, repo, prNumber));
      const resolvedAndOutdatedThreads = threadMaps.resolvedAndOutdatedThreads;
      const resolvedAndNotOutdatedThreads=threadMaps.resolvedAndNotOutdatedThreads;
      const unresolvedAndOutdatedThreads= threadMaps.unresolvedAndOutdatedThreads;
      const unresolvedAndNotOutdatedThreadMap = threadMaps.unresolvedAndNotOutdatedThread;

      let ishighSeveverityCommentIsNotResolved = false;


      // Outdated comments:
      // Need to check false positives here. As the updated code may or may not violate the conditions.

      // Active comments.
      // One which are marked resolved should be considered seriously.

      if(resolvedAndNotOutdatedThreads.length>0){
        ishighSeveverityCommentIsNotResolved = true;
        info("Please resolve these comments..")
        resolvedAndNotOutdatedThreads.forEach(
          (thread: { comments: { nodes: { status: string; url:string; resolvedBy: string }[] } }) => {
            const firstComment=thread.comments.nodes[0];
            info(`URL: ${firstComment.url}`)
            info(`Conversation is marked resolved by ${firstComment.resolvedBy}`)
          }
        )
        info(`Kindly follow the comments provided by RazorGenius`)
      }
      if(unresolvedAndNotOutdatedThreadMap.length>0){
        ishighSeveverityCommentIsNotResolved = true;
        info("Please resolve these comments..")
        unresolvedAndNotOutdatedThreadMap.forEach(
          (thread: { comments: { nodes: { status: string; url:string; resolvedBy: string }[] } }) => {
            const firstComment=thread.comments.nodes[0];
            info(`URL: ${firstComment.url}`)
          }
        )
        info(`Kindly follow the comments provided by RazorGenius`)
      }



      return ishighSeveverityCommentIsNotResolved

    } catch (error) {
      console.error('Error analyzing PR comments:', error);
      throw error;
    }
  }
}