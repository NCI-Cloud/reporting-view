-- metadata - note that this part of the design may change
create table metadata (
	table_name varchar(64), -- this should be an enum, but it's not worth doing that until we know what all the tables are
	ts timestamp default current_timestamp on update current_timestamp
);

-- what else? Also, how to keep this up to date? Triggers, or just enforce it
-- programmatically? Or is that metadata kept in the mysql information_schema
-- somewhere?
--
-- As defined, the timestamp will be updated whenever the matching row is
-- updated, even when the ts column isn't actually set. In addition, we can
-- set the ts value to null, which will update the timestamp to the current
-- value.

-- hypervisors!
--
-- no interaction with other tables at present.
create table hypervisors (
        id int(11),
        hostname varchar(255),
        ip_address varchar(39),
        cpus int(11),
        memory int(11),
        local_storage int(11),
        primary key (id),
        key hypervisors_hostname (hostname),
        key hypervisors_ip (ip_address)
);

insert into hypervisors
select
        id,
        hypervisor_hostname as hostname,
        host_ip as ip_address,
        vcpus as cpus,
        memory_mb as memory,
        local_gb as local_storage
from
        nova.compute_nodes;

-- projects comes first
create table projects (
        uuid varchar(36),
        display_name varchar(64),
        enabled boolean,
        quota_instances int,
        quota_vcpus int,
        quota_memory int,
        quota_volume_total int,
        quota_snapshot int,
        quota_volume_count int,
        primary key (uuid)
);

insert into projects
select
        distinct p.id as uuid,
        p.name as display_name,
        p.enabled as enabled,
        i.hard_limit as instances,
        c.hard_limit as cores,
        r.hard_limit as ram,
        g.total_limit as gigabytes,
        v.total_limit as volumes,
        s.total_limit as snapshots
from
        keystone.project as p left outer join
        (
        select  *  from  nova.quotas
        where deleted = 0 and resource = 'ram'
        ) as r on p.id = r.project_id left outer join
        (
        select  *  from  nova.quotas
        where deleted = 0 and resource = 'instances'
        ) as i on p.id = i.project_id left outer join
        (
        select  *  from  nova.quotas
        where deleted = 0 and resource = 'cores'
        ) as c on p.id = c.project_id left outer join
        (
        select
                project_id,
                sum(if(hard_limit>=0,hard_limit,0)) as total_limit
        from
                cinder.quotas
        where deleted = 0 and resource like 'gigabytes%'
        group by project_id
        ) as g on p.id = g.project_id left outer join
        (
        select
                project_id,
                sum(if(hard_limit>=0,hard_limit,0)) as total_limit
        from
                cinder.quotas
        where deleted = 0 and resource like 'volumes%'
        group by project_id
        ) as v on p.id = v.project_id left outer join
        (
        select
                project_id,
                sum(if(hard_limit>=0,hard_limit,0)) as total_limit
        from
                cinder.quotas
        where deleted = 0 and resource like 'snapshots%'
        group by project_id
        ) as s on p.id = s.project_id;

-- this one is a real pain, because the flavorid is very similar to the uuid
-- elsewhere, but it's /not/ unique. I didn't want to expose that kind of shit,
-- but there are conflicts otherwise that require me to select only non-deleted
-- records if I stick to the 'uuid' as key.
create table flavours (
        id int(11),
        uuid varchar(36),
        name varchar(255),
        vcpus int,
        memory int,
        root int,
        ephemeral int,
        public boolean,
        primary key (id)
);

insert into flavours
select
        id,
        flavorid as uuid,
        name,
        vcpus,
        memory_mb as memory,
        root_gb as root,
        ephemeral_gb as ephemeral,
        is_public as public
from
        nova.instance_types;

-- instances depends on projects and flavours
create table instances (
        project_id varchar(36),
        uuid varchar(36),
        name varchar(64),
        vcpus int,
        memory int,
        root int,
        ephemeral int,
        flavour int(11),
        created datetime,
        deleted datetime,
        allocation_time int,
        wall_time int,
        cpu_time int,
        active boolean,
        primary key (uuid),
        foreign key (project_id) references projects(uuid),
        foreign key (flavour) references flavours(id),
        key instances_project_id_key (project_id)
);

insert into instances
select
        project_id,
        uuid,
        display_name as name,
        vcpus,
        memory_mb as memory,
        root_gb as root,
        ephemeral_gb as ephemeral,
        instance_type_id as flavour,
        created_at as created,
        deleted_at as deleted,
        unix_timestamp(ifnull(deleted_at,now()))-unix_timestamp(created_at) as allocation_time,
        0 as wall_time,
        0 as cpu_time,
        if(deleted<>0,false,true) as active
from
        nova.instances;


-- likewise, volumes (and all the others, in fact) depend on the projects table
create table volumes (
        uuid varchar(36),
        project_id varchar(36),
        display_name varchar(64),
	size int(11),
        created datetime,
        deleted datetime,
        attached boolean,
        instance_uuid varchar(36),
        primary key (uuid),
        foreign key (project_id) references projects(uuid)
);

insert into volumes
select
        id as uuid,
        project_id,
        display_name,
	size,
        created_at as created,
        deleted_at as deleted,
        if(attach_status='attached',true,false) as attached,
        instance_uuid
from
        cinder.volumes;



create table images (
        uuid varchar(36),
        project_id varchar(36),
        name varchar(255),
        size int,
        status varchar(30),
        public boolean,
        created datetime,
        deleted datetime,
        primary key (uuid),
        foreign key (project_id) references projects(uuid)
);

insert into images
select
        id as uuid,
        owner as project_id,
        name,
        size,
        status,
        is_public as public,
        created_at as created,
        deleted_at as deleted
from
        glance.images;


