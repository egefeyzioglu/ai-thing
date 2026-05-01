import clsx from "clsx";
import Image from "next/image";

type ReferenceImageProps = {
    url: string,
    onSelect: any,
    isSelected: boolean
}

export default function ReferenceImage(props: ReferenceImageProps){
    return (
        <div className={clsx("p-1", props.isSelected ? "bg-blue-500" : "")}>
            <Image width={100} height={100} alt="Reference Image" onClick={props.onSelect} src={props.url} />
        </div>
    );
}