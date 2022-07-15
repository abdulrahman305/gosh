#![allow(unused_variables)]
#![allow(unused_imports)]
use super::GitHelper;
use crate::blockchain::{CreateBranchOperation, ZERO_SHA};
use crate::blockchain::{self, tree::into_tree_contract_complient_path};
use git2::Repository;
use git_diff;
use git_hash::{self, ObjectId};
use git_object;
use git_odb;
use git_odb::FindExt;
use git_odb::{Find, Write};
use git_repository::OdbHandle;
use git_repository::{self, Object};
use std::env::current_dir;
use std::os;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::{
    collections::{
        HashSet,
        VecDeque,
        HashMap
    },
    error::Error,
    str::FromStr,
    vec::Vec,
};
mod utilities;
mod parallel_diffs_upload_support;
use parallel_diffs_upload_support::{
    ParallelDiffsUploadSupport,
    ParallelDiff
};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

#[derive(Default)]
struct PushBlobStatistics {
    pub new_snapshots: u32,
    pub diffs: u32,
}

impl PushBlobStatistics {
    pub fn new() -> Self { 
        Self { new_snapshots: 0, diffs: 0 } 
    }

    pub fn add(&mut self, another: &Self) {
        self.new_snapshots += another.new_snapshots;
        self.diffs += another.diffs;
    }
}

impl GitHelper {
    #[instrument(level = "debug", skip(statistics, parallel_diffs_upload_support))]
    async fn push_new_blob(
        &mut self,
        file_path: &str,
        blob_id: &ObjectId,
        commit_id: &ObjectId,
        branch_name: &str,
        statistics: &mut PushBlobStatistics, 
        parallel_diffs_upload_support: &mut ParallelDiffsUploadSupport 
    ) -> Result<()> {
        blockchain::snapshot::push_initial_snapshot(
            self,
            branch_name,
            file_path,
        ).await?;
        
        let file_diff = utilities::generate_blob_diff(
            &self.local_repository().objects,
            None,
            blob_id,
        ).await?;
        let diff = ParallelDiff::new(
            commit_id.clone(),
            branch_name.to_string(),
            blob_id.clone(),
            file_path.to_string(),
            file_diff.clone()
        );
        parallel_diffs_upload_support.push(
            self,
            diff
        ).await?;
        statistics.new_snapshots += 1;
        statistics.diffs += 1;
        Ok(())
    }

    #[instrument(level = "debug")]
    fn tree_root_for_commit(&mut self, commit_id: &ObjectId) -> ObjectId {
        let mut buffer: Vec<u8> = Vec::new();
        return self
            .local_repository()
            .objects
            .try_find(commit_id, &mut buffer)
            .expect("odb must work")
            .expect("commit must be in the local repository")
            .decode()
            .expect("Commit is commit")
            .as_commit()
            .expect("It must be a commit object")
            .tree();
    }

    #[instrument(level = "debug", skip(parallel_diffs_upload_support))]
    async fn push_blob(
        &mut self,
        blob_id: &ObjectId,
        prev_commit_id: &Option<ObjectId>,
        current_commit_id: &ObjectId,
        branch_name: &str,
        parallel_diffs_upload_support: &mut ParallelDiffsUploadSupport
    ) -> Result<PushBlobStatistics> {
        let mut statistics = PushBlobStatistics::new();
        let prev_tree_root_id: Option<ObjectId> = {
            let buffer: Vec<u8> = Vec::new();
            match prev_commit_id {
                None => None,
                Some(id) => Some(self.tree_root_for_commit(id)),
            }
        };
        let mut blob_file_path_occurrences: Vec<PathBuf> = Vec::new();
        {
            let tree_root_id = self.tree_root_for_commit(current_commit_id);
            utilities::find_tree_blob_occurrences(
                &PathBuf::new(),
                &self.local_repository().objects,
                &tree_root_id,
                &blob_id,
                &mut blob_file_path_occurrences,
            )?;
        }
        for file_path in blob_file_path_occurrences.iter() {
            let file_path = into_tree_contract_complient_path(file_path);
            let prev_state_blob_id: Option<ObjectId> = utilities::try_find_tree_leaf(
                &self.local_repository().objects,
                prev_tree_root_id,
                &PathBuf::from(&file_path),
            )?;
            match prev_state_blob_id {
                None => {
                    // This path is new
                    // (we're not handling renames yet)
                    self.push_new_blob(
                        &file_path, 
                        blob_id, 
                        current_commit_id, 
                        branch_name,
                        &mut statistics,
                        parallel_diffs_upload_support,
                    ).await?;
                },
                Some(prev_state_blob_id) => {
                    let file_diff = utilities::generate_blob_diff(
                        &self.local_repository().objects,
                        Some(&prev_state_blob_id),
                        blob_id,
                    ).await?;
                    let diff = ParallelDiff::new(
                        current_commit_id.clone(),
                        branch_name.to_string(),
                        blob_id.clone(),
                        file_path.clone(),
                        file_diff.clone() 
                    );
                    parallel_diffs_upload_support.push(
                        self,
                        diff
                    ).await?;
                    statistics.diffs += 1;
                }
            }
        }
        Ok(statistics)
    }

    // find ancestor commit
    #[instrument(level = "debug", skip(self))]
    async fn push_ref(&mut self, local_ref: &str, remote_ref: &str) -> Result<String> {
        log::info!("push_ref {} : {}", local_ref, remote_ref);
        let branch_name: &str = {
            let mut iter = local_ref.rsplit("/");
            iter.next().unwrap()
        };
        // 1. Check if branch exists and ready in the blockchain
        let remote_branch_name: &str = {
            let mut iter = remote_ref.rsplit("/");
            iter.next().unwrap()
        };
        let parsed_remote_ref =
            blockchain::remote_rev_parse(&self.es_client, &self.repo_addr, remote_branch_name).await?;

        // 2. Find ancestor commit in local repo
        let mut ancestor_commit_id = if parsed_remote_ref == None {
            "".to_owned()
        } else {
            let remote_commit_addr = parsed_remote_ref.clone().unwrap();
            let commit = blockchain::get_commit_by_addr(&self.es_client, &remote_commit_addr)
                .await?
                .unwrap();
            commit.sha
        };

        let latest_commit_id = self
            .local_repository()
            .find_reference(local_ref)?
            .into_fully_peeled_id()?
            .object()?
            .id;

        log::debug!("latest commit id {latest_commit_id}");

        // TODO: git rev-list?
        let mut cmd_args: Vec<&str> = vec![
            "rev-list",
            "--objects",
            "--in-commit-order",
            "--reverse",
            local_ref,
        ];

        let exclude;
        let mut commit_id: Option<ObjectId> = None;
        if ancestor_commit_id != "" {
            exclude = format!("^{}", ancestor_commit_id);
            cmd_args.push(&exclude);
            commit_id = Some(ObjectId::from_str(&ancestor_commit_id)?);
        }

        let cmd = Command::new("git")
            .args(cmd_args)
            .stdout(Stdio::piped())
            .spawn()
            .expect("git rev-list failed");

        let cmd_out = cmd.wait_with_output()?;
        // 4. Do prepare commit for all commits
        // 5. Deploy tree objects of all commits

        // 6. Deploy all **new** snapshot
        // 7. Deploy diff contracts
        // 8. Deploy all commit objects

        let mut prev_commit_id: Option<ObjectId> = None;
        let mut statistics = PushBlobStatistics::new();
        let mut parallel_diffs_upload_support = ParallelDiffsUploadSupport::new(&latest_commit_id);
        // TODO: Handle deleted fules
        // Note: These files will NOT appear in the list here
        let out = String::from_utf8(cmd_out.stdout)?;
        // 3. If branch needs to be created do so
        if parsed_remote_ref == None {
            //    ---
            //    Otherwise check if a head of the branch
            //    is pointing to the ancestor commit. Fail
            //    if it doesn't
            if ancestor_commit_id == "" {
                ancestor_commit_id = out.lines().next().unwrap().to_string();
            }
            let originate_commit = git_hash::ObjectId::from_str(&ancestor_commit_id)?;
            let mut create_branch_op = CreateBranchOperation::new(originate_commit, branch_name, self);
            create_branch_op.run().await;
        }

        for line in out.lines() {
            match line.split_ascii_whitespace().nth(0) {
                Some(oid) => {
                    let object_id = git_hash::ObjectId::from_str(oid)?;
                    let object_kind = self.local_repository().find_object(object_id)?.kind;
                    match object_kind {
                        git_object::Kind::Commit => {
                            blockchain::push_commit(self, &object_id, branch_name).await?;
                            prev_commit_id = commit_id;
                            commit_id = Some(object_id);
                        }
                        git_object::Kind::Blob => {
                            let results = self.push_blob(
                                &object_id,
                                &prev_commit_id,
                                commit_id.as_ref().unwrap(),
                                branch_name,
                                &mut parallel_diffs_upload_support
                            )
                            .await?;
                            statistics.add(&results);
                            // branch
                            // commit_id
                            // commit_data
                            // Vec<diff>
                        }
                        // Not supported yet
                        git_object::Kind::Tag => unimplemented!(),
                        git_object::Kind::Tree => blockchain::push_tree(self, &object_id).await?,
                    }
                }
                None => break,
            }
        }
        parallel_diffs_upload_support.push_dangling(self).await?; 
        // 9. Set commit (move HEAD)
        blockchain::notify_commit(
            self, 
            &latest_commit_id, 
            branch_name, 
            parallel_diffs_upload_support.get_parallels_number() 
        ).await?;

        // 10. move HEAD
        //
        let result_ok = format!("ok {remote_ref}\n");
        Ok(result_ok)
    }

    #[instrument(level = "debug", skip(self))]
    pub async fn push(&mut self, refs: &str) -> Result<Vec<String>> {
        let splitted: Vec<&str> = refs.split(":").collect();
        let result = match splitted.as_slice() {
            [remote_ref] => delete_remote_ref(remote_ref).await?,
            [local_ref, remote_ref] => self.push_ref(local_ref, remote_ref).await?,
            _ => unreachable!(),
        };

        Ok(vec![result])
    }
}

async fn delete_remote_ref(remote_ref: &str) -> Result<String> {
    Ok("delete ref ok".to_owned())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use git2::{
        string_array::StringArray, Branch, IndexAddOption, IndexTime, Repository, Signature, Time,
    };

    use super::*;

    // #[tokio::test]
    // async fn ensure_push_ok() {
    //     let local_ref = "refs/heads/demo";
    //     let push_result = push_ref(local_ref, "refs/heads/demo").await.unwrap();
    //     assert_eq!(format!("ok {}", local_ref), push_result);
    // }

    #[tokio::test]
    async fn test_push() -> Result<()> {
        log::info!("Preparing repository for tests");
        // TODO: rewrite from libgit2 to gitoxide
        let dir = std::env::temp_dir().join("test_push");

        fs::remove_dir_all(&dir)?;
        fs::create_dir_all(&dir)?;
        fs::write(dir.join("readme.txt").to_owned(), "test")?;
        log::info!("Initializing git repo");
        println!("Testing push {:?}", dir);

        let repo = Repository::init(dir).expect("repository init successfuly");
        repo.remote_set_url(
            "origin",
            "gosh::vps23.ton.dev://0:54fdd2ac8027b16c83b2b8b0cc4360ff4135a936c355bdb5c4776bdd3190fefc/dadao/somefiles",
        )?;

        let mut index = repo.index()?;
        index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None)?;
        index.write()?;

        let tree = index.write_tree()?;

        let author = Signature::new("tester", "test@test.test", &Time::new(0, 0))?;

        let update_ref = Some("HEAD");

        repo.commit(
            update_ref,
            &author,
            &author,
            "message",
            &repo.find_tree(tree)?,
            &[],
        )?;

        let head = repo.head()?;
        println!("head {:?}", head.name());
        let full_ref = repo.resolve_reference_from_short_name("main")?;
        let commit = repo.reference_to_annotated_commit(&full_ref)?;

        println!("commit {:?}", commit.id());

        // get current branch
        let branch = Branch::wrap(head);
        // set upstream
        // branch set upstream "origin"
        // branch.set_upstream(repo.remotes()?.get(0))?;

        // get remote ref
        // let remote_ref = repo.branch_remote_name()

        // push

        // push_ref()

        Ok(())
    }
}
