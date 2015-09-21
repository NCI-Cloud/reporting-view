drop database if exists reporting;

create database reporting;
use reporting;

-- some user definitions
grant select on *.* to 'reporting-update'@'localhost'  identified by 'needs to be set';
grant select,update,insert,delete on reporting.* to 'reporting-update'@'localhost' identified by 'needs to be set';
grant select on reporting.* to 'reporting-query'@'%' identified by 'also needs to be set';

-- metadata - note that this part of the design may change
create table metadata (
        table_name varchar(64), -- this should be an enum, but it's not worth doing that until we know what all the tables are
        last_update timestamp default current_timestamp on update current_timestamp,
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

-- Physical machines hosting running hypervisor software, aka compute nodes.
--
-- no interaction with other tables at present.
create table hypervisor (
        id int(11) comment "Compute node unique identifier",
        hostname varchar(255) comment "Compute node hostname",
        ip_address varchar(39) comment "Compute node IP address",
        cpus int(11) comment "Number of installed CPU cores",
        memory int(11) comment "Total installed memory in MB",
        local_storage int(11) comment "Total local disk in GB",
        primary key (id),
        key hypervisor_hostname (hostname),
        key hypervisor_ip (ip_address)
) comment "Compute nodes";

delimiter //
create definer = 'reporting-update'@'localhost' procedure hypervisor_update()
deterministic
begin
declare ts datetime;
declare r int(1);
select count(*) into r from metadata where table_name = 'hypervisor';
if r = 0 then
insert into metadata (table_name, last_update) values ('hypervisor', null);
end if;
select ifnull(ts,from_unixtime(0)) into ts from metadata where table_name = 'hypervisor';
if date_sub(now(), interval 600 second) > ts then
replace into hypervisor
select
        id,
        hypervisor_hostname as hostname,
        host_ip as ip_address,
        vcpus as cpus,
        memory_mb as memory,
        local_gb as local_storage
from
        nova.compute_nodes;
insert into metadata (table_name, last_update) values ('hypervisor', null)
on duplicate key update last_update = null;
end if;
end;
//
delimiter ;

grant execute on procedure reporting.hypervisor_update to 'reporting-update'@'localhost';
grant execute on procedure reporting.hypervisor_update to 'reporting-query'@'%';

call hypervisor_update();

-- Projects (otherwise known as tenants) group both users and resources such as instances.
-- Projects are also the finest-grained entity which has resource quotas.
create table project (
        id varchar(36) comment "Unique identifier",
        display_name varchar(64) comment "Human-readable display name",
        enabled boolean comment "If false, the project is not usable by users",
        quota_instances int comment "Maximum concurrent instances",
        quota_vcpus int comment "Maximum concurrent virtual processor cores",
        quota_memory int comment "Maximum memory concurrently allocated in MB",
        quota_volume_total int comment "Maximum total size of storage volumes in GB",
        quota_snapshot int comment "Maximum number of volume snapshots",
        quota_volume_count int comment "Maximum number of concurrently allocated volumes",
        primary key (id)
) comment "Project resource quotas";

delimiter //

create definer = 'reporting-update'@'localhost' procedure project_update()
deterministic
begin
declare ts datetime;
declare r int(1);
select count(*) into r from metadata where table_name = 'project';
if r = 0 then
insert into metadata (table_name, last_update) values ('project', null);
end if;
select ifnull(ts,from_unixtime(0)) into ts from metadata where table_name = 'project';
if date_sub(now(), interval 600 second) > ts then
replace into project
select
        distinct kp.id as id,
        kp.name as display_name,
        kp.enabled as enabled,
        i.hard_limit as instances,
        c.hard_limit as cores,
        r.hard_limit as ram,
        g.total_limit as gigabytes,
        v.total_limit as volumes,
        s.total_limit as snapshots
from
        keystone.project as kp left outer join
        (
        select  *  from  nova.quotas
        where deleted = 0 and resource = 'ram'
        ) as r on kp.id = r.project_id left outer join
        (
        select  *  from  nova.quotas
        where deleted = 0 and resource = 'instances'
        ) as i on kp.id = i.project_id left outer join
        (
        select  *  from  nova.quotas
        where deleted = 0 and resource = 'cores'
        ) as c on kp.id = c.project_id left outer join
        (
        select
                project_id,
                sum(if(hard_limit>=0,hard_limit,0)) as total_limit
        from
                cinder.quotas
        where deleted = 0 and resource like 'gigabytes%'
        group by project_id
        ) as g on kp.id = g.project_id left outer join
        (
        select
                project_id,
                sum(if(hard_limit>=0,hard_limit,0)) as total_limit
        from
                cinder.quotas
        where deleted = 0 and resource like 'volumes%'
        group by project_id
        ) as v on kp.id = v.project_id left outer join
        (
        select
                project_id,
                sum(if(hard_limit>=0,hard_limit,0)) as total_limit
        from
                cinder.quotas
        where deleted = 0 and resource like 'snapshots%'
        group by project_id
        ) as s on kp.id = s.project_id;
insert into metadata (table_name, last_update) values ('project', null)
on duplicate key update last_update = null;
end if;
end;
//
delimiter ;

grant execute on procedure reporting.project_update to 'reporting-update'@'localhost';
grant execute on procedure reporting.project_update to 'reporting-query'@'%';

call project_update();

-- Users 
create table user (
        id  varchar(64) comment "User unique identifier",
        name varchar(255) comment "User name",
        email varchar(255) comment "User email address",
        default_project varchar(36) comment "User default project",
        enabled boolean,
        primary key (id)
) comment "Users";


delimiter //
create definer = 'reporting-update'@'localhost' procedure user_update()
deterministic
begin
declare ts datetime;
declare r int(1);
select count(*) into r from metadata where table_name = 'user';
if r = 0 then
insert into metadata (table_name, last_update) values ('user', null);
end if;
select ifnull(ts,from_unixtime(0)) into ts from metadata where table_name = 'user';
if date_sub(now(), interval 600 second) > ts then
replace into user
select
        id,
        name,
        trim(trailing '"}' from right(extra, (length(extra)-(locate('"email": "', extra)+9)))) as email,
        default_project_id as default_project,
        enabled
from
        keystone.user;
insert into metadata (table_name, last_update) values ('user', null)
on duplicate key update last_update = null;
end if;
end;
//
delimiter ;

grant execute on procedure reporting.user_update to 'reporting-update'@'localhost';
grant execute on procedure reporting.user_update to 'reporting-query'@'%';

call user_update();

-- user roles in projects. Note that this is a many to many relationship:
-- a user can have roles in many projects, and a project may have many users.
create table `role` (
        role varchar(255) comment "Role name",
        user varchar(64) comment "User ID this role is assigned to",
        project varchar(36) comment "Project ID the user is assigned this role in",
        foreign key role_user_fkey (user) references user(id),
        foreign key role_project_fkey (project) references project(id)
) comment "User membership of projects, with roles";

delimiter //
create definer = 'reporting-update'@'localhost' procedure role_update()
deterministic
begin
declare ts datetime;
declare r int(1);
select count(*) into r from metadata where table_name = 'role';
if r = 0 then
insert into metadata (table_name, last_update) values ('role', null);
end if;
select ifnull(ts,from_unixtime(0)) into ts from metadata where table_name = 'role';
if date_sub(now(), interval 600 second) > ts then
replace into role
select
        kr.name as role,
        ka.actor_id as user,
        ka.target_id as project
from
        keystone.assignment as ka join keystone.role as kr
        on ka.role_id = kr.id
where
        ka.type = 'UserProject'
        AND EXISTS(select * from keystone.user ku WHERE ku.id =  ka.actor_id)
        AND EXISTS(select * from keystone.project kp WHERE kp.id = ka.target_id);
insert into metadata (table_name, last_update) values ('role', null)
on duplicate key update last_update = null;
end if;
end;
//
delimiter ;

grant execute on procedure reporting.role_update to 'reporting-update'@'localhost';
grant execute on procedure reporting.role_update to 'reporting-query'@'%';

call role_update();



-- this one is a real pain, because the flavorid is very similar to the uuid
-- elsewhere, but it's /not/ unique. I didn't want to expose that fact,
-- but there are conflicts otherwise that require me to select only non-deleted
-- records if I stick to the 'uuid' as key.
create table flavour (
        id int(11) comment "Flavour ID",
        uuid varchar(36) comment "Flavour UUID - not unique",
        name varchar(255) comment "Flavour name",
        vcpus int comment "Number of vCPUs",
        memory int comment "Memory in MB",
        root int comment "Size of root disk in GB",
        ephemeral int comment "Size of ephemeral disk in GB",
        public boolean comment "Is this flavour publically available",
        primary key (id),
        key flavour_uuid_key (uuid)
) comment "Types of virtual machine";

delimiter //
create definer = 'reporting-update'@'localhost' procedure flavour_update()
deterministic
begin
declare ts datetime;
declare r int(1);
select count(*) into r from metadata where table_name = 'flavour';
if r = 0 then
insert into metadata (table_name, last_update) values ('flavour', null);
end if;
select ifnull(ts,from_unixtime(0)) into ts from metadata where table_name = 'flavour';
if date_sub(now(), interval 600 second) > ts then
replace into flavour
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
insert into metadata (table_name, last_update) values ('flavour', null)
on duplicate key update last_update = null;
end if;
end;
//
delimiter ;

grant execute on procedure reporting.flavour_update to 'reporting-update'@'localhost';
grant execute on procedure reporting.flavour_update to 'reporting-query'@'%';

call flavour_update();

-- instances depend on projects and flavours
create table instance (
        id varchar(36) comment "Instance UUID",
        project_id varchar(36) comment "Project UUID that owns this instance",
        name varchar(64) comment "Instance name",
        vcpus int comment "Allocated number of vCPUs",
        memory int comment "Allocated memory in MB",
        root int comment "Size of root disk in GB",
        ephemeral int comment "Size of ephemeral disk in GB",
        flavour int(11) comment "Flavour id used to create instance",
        created_by varchar(36) comment "id of user who created this instance",
        created datetime comment "Time instance was created",
        deleted datetime comment "Time instance was deleted",
        allocation_time int comment "Number of seconds instance has existed",
        wall_time int comment "Number of seconds instance has been in active state",
        cpu_time int comment "Number of seconds instance has been using CPU",
        active boolean comment "True if the instance is currently active",
        hypervisor varchar(255) comment "Hypervisor the instance is running on",
        availability_zone varchar(255) comment "Availability zone the instance is running in",
        primary key (id),
        key instance_name_key (name),
        key instance_project_id_key (project_id),
        key instance_hypervisor_key (hypervisor),
        key instance_az_key (availability_zone)
) comment "Virtual machine instances";

delimiter //

create definer = 'reporting-update'@'localhost' procedure instance_update()
deterministic
begin
declare ts datetime;
declare r int(1);
select count(*) into r from metadata where table_name = 'instance';
if r = 0 then
insert into metadata (table_name, last_update) values ('instance', null);
end if;
select ifnull(ts,from_unixtime(0)) into ts from metadata where table_name = 'instance';
if date_sub(now(), interval 600 second) > ts then
replace into instance
select
        uuid as id,
        project_id,
        display_name as name,
        vcpus,
        memory_mb as memory,
        root_gb as root,
        ephemeral_gb as ephemeral,
        instance_type_id as flavour,
        user_id as created_by,
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
insert into metadata (table_name, last_update) values ('instance', null)
on duplicate key update last_update = null;
end if;
end;
//
delimiter ;

grant execute on procedure reporting.instance_update to 'reporting-update'@'localhost';
grant execute on procedure reporting.instance_update to 'reporting-query'@'%';

call instance_update();

-- Storage volumes independent of (but attachable to) virtual machines
-- Volumes (and all the others, in fact) depend on the projects table
create table volume (
        id varchar(36) comment "Volume UUID",
        project_id varchar(36) comment "Project ID that owns this volume",
        display_name varchar(64) comment "Volume display name",
        size int(11) comment "Size in MB",
        created datetime comment "Volume created at",
        deleted datetime comment "Volume deleted at",
        attached boolean comment "Volume attached or not",
        instance_uuid varchar(36) comment "Instance the volume is attached to",
        availability_zone varchar(255) comment "Availability zone the volume exists in",
        primary key (id),
        key volume_project_id_key (project_id),
        key volume_instance_uuid_key (instance_uuid),
        key volume_az_key (availability_zone)
) comment "External storage volumes";

delimiter //

create definer = 'reporting-update'@'localhost' procedure volume_update()
deterministic
begin
declare ts datetime;
declare r int(1);
select count(*) into r from metadata where table_name = 'volume';
if r = 0 then
insert into metadata (table_name, last_update) values ('volume', null);
end if;
select ifnull(ts,from_unixtime(0)) into ts from metadata where table_name = 'volume';
if date_sub(now(), interval 600 second) > ts then
replace into volume
select
        id,
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
insert into metadata (table_name, last_update) values ('volume', null)
on duplicate key update last_update = null;
end if;
end;
//
delimiter ;

grant execute on procedure reporting.volume_update to 'reporting-update'@'localhost';
grant execute on procedure reporting.volume_update to 'reporting-query'@'%';

call volume_update();

create table image (
        id varchar(36) comment "Image UUID",
        project_id varchar(36) comment "Project ID that owns this image",
        name varchar(255) comment "Image display name",
        size int comment "Size of image in MB",
        -- TODO: It would be nice if status were an enum, and if the view layer could somehow see that.
        status varchar(30) comment "Current status of image",
        public boolean comment "Is this image publically available",
        created datetime comment "Time image was created",
        deleted datetime comment "Time image was deleted",
        primary key (id),
        key image_project_id_key (project_id)
) comment "Operating system images";

delimiter //

create definer = 'reporting-update'@'localhost' procedure image_update()
deterministic
begin
declare ts datetime;
declare r int(1);
select count(*) into r from metadata where table_name = 'image';
if r = 0 then
insert into metadata (table_name, last_update) values ('image', null);
end if;
select ifnull(ts,from_unixtime(0)) into ts from metadata where table_name = 'image';
if date_sub(now(), interval 600 second) > ts then
replace into image
select
        id,
        owner as project_id,
        name,
        size,
        status,
        is_public as public,
        created_at as created,
        deleted_at as deleted
from
        glance.images;
insert into metadata (table_name, last_update) values ('image', null)
on duplicate key update last_update = null;
end if;
end;
//
delimiter ;

grant execute on procedure reporting.image_update to 'reporting-update'@'localhost';
grant execute on procedure reporting.image_update to 'reporting-query'@'%';

call image_update();
