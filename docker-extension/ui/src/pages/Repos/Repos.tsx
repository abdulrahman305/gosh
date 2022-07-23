import React, { useState } from "react";
import { Link, useOutletContext, useParams, Outlet } from "react-router-dom";
import { useGoshRoot } from "./../../hooks/gosh.hooks";
import { GoshRepository } from "./../../types/classes";
import { IGoshRepository, IGoshRoot, IGoshDao } from "./../../types/types";
import { useQuery } from "react-query";
import RepoListItem from "./RepoListItem";
import { TDaoLayoutOutletContext } from "./../Dao";
import { Loader, LoaderDotsText, FlexContainer, Flex, Modal } from "./../../components";
import Button from '@mui/material/Button'
import { PlusIcon, CollectionIcon, UsersIcon, ArrowRightIcon, EmojiSadIcon } from '@heroicons/react/outline';
import InputBase from '@mui/material/InputBase';



const RepositoriesList = ({
  goshRoot,
  goshDao,
  daoName,
  search
}: {
  goshRoot: IGoshRoot | undefined,
  goshDao: IGoshDao,
  daoName: string | undefined,
  search: string}) => {
    const repoListQuery = useQuery(
      ['repositoryList'],
      async (): Promise<IGoshRepository[]> => {
        if (!goshRoot) return [];

        // Get GoshDaoRepoCode by GoshDao address and get all repos addreses
        const repoCode = await goshRoot.getDaoRepoCode(goshDao.address);
        console.debug('Repo code', repoCode);
        const reposAddrs = await goshRoot.account.client.net.query_collection({
            collection: 'accounts',
            filter: {
                code: { eq: repoCode }
            },
            result: 'id'
        });
        console.debug('GoshRepos addreses:', reposAddrs?.result || []);

        // Create GoshRepository objects
        const repos = await Promise.all(
            (reposAddrs?.result || []).map(async (item) => {
                const repo = new GoshRepository(goshRoot.account.client, item.id);
                await repo.load();
                return repo;
            })
        );
        console.debug('GoshRepos:', repos);
        return repos;
      },
      {
        enabled: !!goshRoot,
        select: (data) => {
          if (!search) return data;
          const pattern = new RegExp(search, 'i');
          return data.filter((repo) => repo.meta && repo.meta.name.search(pattern) >= 0);
        }
      }
    );
    return (
      <div>

        {(repoListQuery.isIdle || repoListQuery.isLoading) && (
          <div className="loader">
            <Loader />
            Loading {"repositories"}...
          </div>
        )}

        {repoListQuery.isFetched && !repoListQuery.data?.length && (
          <div className="no-data"><EmojiSadIcon/>There are no repositories</div>
        )}

        {repoListQuery.data?.map((repository, index) => (
            daoName && <RepoListItem key={index} daoName={daoName} repository={repository} />
        ))}

      </div>);
}
const RepositoriesPage = () => {
    const [search, setSearch] = useState<string>("");
    const goshRoot = useGoshRoot();
    const { goshDao } = useOutletContext<TDaoLayoutOutletContext>();
    const { daoName } = useParams();
    

    return (
      <>
        <div className="page-header">
          <FlexContainer
              direction="row"
              justify="space-between"
              align="flex-start"
          >
            <Flex>
                <h2>Repositories</h2>
            </Flex>
            <Flex>
              {goshDao
              ?
                <Link
                  to={`/organizations/${goshDao.meta?.name}/repositories/create`}
                >
                  <Button
                      color="primary"
                      variant="contained"
                      size="medium"
                      className={"btn-icon"}
                      disableElevation
                      // icon={<Icon icon={"arrow-up-right"}/>}
                      // iconAnimation="right"
                      // iconPosition="after"
                  ><PlusIcon/> Create</Button>
                </Link>
              :
                <Button
                    color="primary"
                    variant="contained"
                    size="medium"
                    className={"btn-icon"}
                    disabled
                    disableElevation
                    // icon={<Icon icon={"arrow-up-right"}/>}
                    // iconAnimation="right"
                    // iconPosition="after"
                ><PlusIcon/> Create</Button>}
            </Flex>
        </FlexContainer>
        <InputBase
          className="input-field"
          type="text"
          placeholder="Search repositories"
          autoComplete={'off'}
          onChange={(event) => setSearch(event.target.value)}
        />

      </div>
      <div className="divider"></div>
      {!goshDao && 
        <div className="loader">
          <Loader />
          Loading {"repositories"}...
        </div>}
      <div>
      {goshDao && <RepositoriesList
        goshDao={goshDao}
        goshRoot={goshRoot}
        daoName={daoName}
        search={search}
      />}
      </div>
    </>
    );
}

export default RepositoriesPage;
