# Github Comment analyzer
The script fetches all the conversations threads for a github Pull request. 
Conversation threads are queried using Graphql.\
Here is the query used. \
```
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
    }

```

There are two flags on which logic can be built.\
1. isResolved: It refers whether a conversation thread has been resolved or not.
2. isOutdated: It refers to given comment, whether the code block has been updated since the comment is pulished on previous commit.

Note: A thread can contain multiple comments.
* Outdated flag is available at both comment and thread level. Not sure what it means at comment level. For example every comment in the thread has this outdated flag.


| IsResolved | IsOutdated |                                                                    Description                                                                    |
|:----------:|:----------:|:-------------------------------------------------------------------------------------------------------------------------------------------------:|
|    True    |    True    | The thread is resolved and comments are also outdated. It means that the conversation has been resolved by someone, and the code is also updated. |
|    True    |   False    |                                           The conversation thread is resolved but code is not updated.                                            |
|   False    |    True    |                                           The conversation thread is not resolved but code is updated.                                            |
|   False    |   False    |                                           Neither the conversation is resolved nor the code is updated.                                           |