drop database if exists reporting;
drop user 'reporting-update'@'localhost';
drop user 'reporting-query'@'%';

create database reporting;
use reporting;

-- some user definitions
create user 'reporting-update'@'localhost' identified by 'needs to be set';
grant select on *.* to 'reporting-update'@'localhost';
grant select,update,insert,delete on reporting.* to 'reporting-update'@'localhost';
create user 'reporting-query'@'%' identified by 'also needs to be set';
grant select on reporting.* to 'reporting-query'@'%';

-- metadata - note that this part of the design may change
create table metadata (
	table_name varchar(64), -- this should be an enum, but it's not worth doing that until we know what all the tables are
	ts timestamp default current_timestamp on update current_timestamp,
	primary key (table_name)
) comment "Database metadata";

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
        id int(11) comment "Compute node ID",
        hostname varchar(255) comment "Compute node hostname",
        ip_address varchar(39) comment "Compute node IP address",
        cpus int(11) comment "Number of installed CPUs",
        memory int(11) comment "Total installed memory in MB",
        local_storage int(11) comment "Total local disk in GB",
        primary key (id),
        key hypervisors_hostname (hostname),
        key hypervisors_ip (ip_address)
) comment "Compute node details";

delimiter //
create definer = 'reporting-update'@'localhost' procedure hypervisors_update()
deterministic
begin
declare ts datetime;
declare r int(1);
select count(*) into r from metadata where table_name = 'hypervisors';
if r = 0 then
insert into metadata (table_name, ts) values ('hypervisors', null);
end if;
select ifnull(ts,from_unixtime(0)) into ts from metadata where table_name = 'hypervisors';
if date_sub(now(), interval 600 second) > ts then
replace into hypervisors
select
        id,
        hypervisor_hostname as hostname,
        host_ip as ip_address,
        vcpus as cpus,
        memory_mb as memory,
        local_gb as local_storage
from
        nova.compute_nodes;
insert into metadata (table_name, ts) values ('hypervisors', null)
on duplicate key update ts = null;
end if;
end;
//
delimiter ;

grant execute on procedure reporting.hypervisors_update to 'reporting-update'@'localhost';
grant execute on procedure reporting.hypervisors_update to 'reporting-query'@'%';

call hypervisors_update();

-- projects comes first
create table projects (
        uuid varchar(36) comment "Project UUID",
        display_name varchar(64) comment "Project display name",
        enabled boolean comment "Is project enabled",
        quota_instances int comment "Project quota - concurrent number of instances",
        quota_vcpus int comment "Project quota - concurrent vCPUs allocated",
        quota_memory int comment "Project quota - concurrent memory allocated in MB",
        quota_volume_total int comment "Project quota - total size of volumes in GB",
        quota_snapshot int comment "Project quota - number of snapshots",
        quota_volume_count int comment "Project quota - number of volumes",
        primary key (uuid)
) comment "Project details and quota information";

delimiter //

create definer = 'reporting-update'@'localhost' procedure projects_update()
deterministic
begin
declare ts datetime;
declare r int(1);
select count(*) into r from metadata where table_name = 'projects';
if r = 0 then
insert into metadata (table_name, ts) values ('projects', null);
end if;
select ifnull(ts,from_unixtime(0)) into ts from metadata where table_name = 'projects';
if date_sub(now(), interval 600 second) > ts then
replace into projects
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
insert into metadata (table_name, ts) values ('projects', null)
on duplicate key update ts = null;
end if;
end;
//
delimiter ;

grant execute on procedure reporting.projects_update to 'reporting-update'@'localhost';
grant execute on procedure reporting.projects_update to 'reporting-query'@'%';

call projects_update();

-- this one is a real pain, because the flavorid is very similar to the uuid
-- elsewhere, but it's /not/ unique. I didn't want to expose that kind of shit,
-- but there are conflicts otherwise that require me to select only non-deleted
-- records if I stick to the 'uuid' as key.
create table flavours (
        id int(11) comment "Flavour ID",
        uuid varchar(36) comment "Flavour UUID - not unique",
        name varchar(255) comment "Flavour name",
        vcpus int comment "Number of vCPUs",
        memory int comment "Memory in MB",
        root int comment "Size of root disk in GB",
        ephemeral int comment "Size of ephemeral disk in GB",
        public boolean comment "Is this flavour publically available",
        primary key (id)
) comment "Flavour details";

delimiter //
create definer = 'reporting-update'@'localhost' procedure flavours_update()
deterministic
begin
declare ts datetime;
declare r int(1);
select count(*) into r from metadata where table_name = 'flavours';
if r = 0 then
insert into metadata (table_name, ts) values ('flavours', null);
end if;
select ifnull(ts,from_unixtime(0)) into ts from metadata where table_name = 'flavours';
if date_sub(now(), interval 600 second) > ts then
replace into flavours
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
insert into metadata (table_name, ts) values ('flavours', null)
on duplicate key update ts = null;
end if;
end;
//
delimiter ;

grant execute on procedure reporting.flavours_update to 'reporting-update'@'localhost';
grant execute on procedure reporting.flavours_update to 'reporting-query'@'%';

call flavours_update();

-- instances depends on projects and flavours
create table instances (
        project_id varchar(36) comment "Project UUID that owns this instance",
        uuid varchar(36) comment "Instance UUID",
        name varchar(64) comment "Instance name",
        vcpus int comment "Number of vCPUs",
        memory int comment "Memory in MB",
        root int comment "Size of root disk in GB",
        ephemeral int comment "Size of ephemeral disk in GB",
        flavour int(11) comment "Flavour id used to create instance",
        created datetime comment "Instance created at",
        deleted datetime comment "Instance deleted at",
        allocation_time int comment "Number of seconds instance has existed",
        wall_time int comment "Number of seconds instance has been running",
        cpu_time int comment "Number of seconds instnace has been using CPU",
        active boolean comment "Is the instance active",
	hypervisor varchar(255) comment "Hypervisor the instance is running on",
	availability_zone varchar(255) comment "Availabilty zone the instance is running in",
        primary key (uuid),
        key instances_project_id_key (project_id),
        key instances_availability_zone_key (availability_zone),
        key instances_hypervisor_key (hypervisor)
) comment "Instance details";

delimiter //

create definer = 'reporting-update'@'localhost' procedure instances_update()
deterministic
begin
declare ts datetime;
declare r int(1);
select count(*) into r from metadata where table_name = 'instances';
if r = 0 then
insert into metadata (table_name, ts) values ('instances', null);
end if;
select ifnull(ts,from_unixtime(0)) into ts from metadata where table_name = 'instances';
if date_sub(now(), interval 600 second) > ts then
replace into instances
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
        if(deleted<>0,false,true) as active,
	host as hypervisor,
	availability_zone
from
        nova.instances;
insert into metadata (table_name, ts) values ('instances', null)
on duplicate key update ts = null;
end if;
end;
//
delimiter ;

grant execute on procedure reporting.instances_update to 'reporting-update'@'localhost';
grant execute on procedure reporting.instances_update to 'reporting-query'@'%';

call instances_update();

-- likewise, volumes (and all the others, in fact) depend on the projects table
create table volumes (
        uuid varchar(36) comment "Volume UUID",
        project_id varchar(36) comment "Project ID that owns this volume",
        display_name varchar(64) comment "Volume display name",
	size int(11) comment "Size in MB",
        created datetime comment "Volume created at",
        deleted datetime comment "Volume deleted at",
        attached boolean comment "Volume attached or not",
        instance_uuid varchar(36) comment "Instance the volume is attached to",
	availability_zone varchar(255) comment "Availability zone the volume exists in",
        primary key (uuid)
) comment "Volume details";

delimiter //

create definer = 'reporting-update'@'localhost' procedure volumes_update()
deterministic
begin
declare ts datetime;
declare r int(1);
select count(*) into r from metadata where table_name = 'volumes';
if r = 0 then
insert into metadata (table_name, ts) values ('volumes', null);
end if;
select ifnull(ts,from_unixtime(0)) into ts from metadata where table_name = 'volumes';
if date_sub(now(), interval 600 second) > ts then
replace into volumes
select
        id as uuid,
        project_id,
        display_name,
	size,
        created_at as created,
        deleted_at as deleted,
        if(attach_status='attached',true,false) as attached,
        instance_uuid,
	availability_zone
from
        cinder.volumes;
insert into metadata (table_name, ts) values ('volumes', null)
on duplicate key update ts = null;
end if;
end;
//
delimiter ;

grant execute on procedure reporting.volumes_update to 'reporting-update'@'localhost';
grant execute on procedure reporting.volumes_update to 'reporting-query'@'%';

call volumes_update();

create table images (
        uuid varchar(36) comment "Image UUID",
        project_id varchar(36) comment "Project ID that owns this image",
        name varchar(255) comment "Image display name",
        size int comment "Size of image in MB",
        status varchar(30) comment "Current status of image",
        public boolean comment "Is this image publically available",
        created datetime comment "Image created at",
        deleted datetime comment "Image deleted at",
        primary key (uuid)
) comment "Image details";

delimiter //

create definer = 'reporting-update'@'localhost' procedure images_update()
deterministic
begin
declare ts datetime;
declare r int(1);
select count(*) into r from metadata where table_name = 'images';
if r = 0 then
insert into metadata (table_name, ts) values ('images', null);
end if;
select ifnull(ts,from_unixtime(0)) into ts from metadata where table_name = 'images';
if date_sub(now(), interval 600 second) > ts then
replace into images
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
insert into metadata (table_name, ts) values ('images', null)
on duplicate key update ts = null;
end if;
end;
//
delimiter ;

grant execute on procedure reporting.images_update to 'reporting-update'@'localhost';
grant execute on procedure reporting.images_update to 'reporting-query'@'%';

call images_update();
